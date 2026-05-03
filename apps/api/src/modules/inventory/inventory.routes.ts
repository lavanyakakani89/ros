import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { InventoryError, InventoryService } from "./inventory.service.js";
import {
  addBatchSchema,
  createProductSchema,
  expiringQuerySchema,
  productIdParamsSchema,
  productListQuerySchema,
  stockAdjustmentSchema,
  updateProductSchema,
} from "./inventory.schema.js";

export const inventoryRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new InventoryService(fastify);

  fastify.post("/api/inventory/products", async (request, reply) => {
    const input = createProductSchema.parse(request.body);
    return handleInventory(reply, () => service.createProduct(request.tenant, input));
  });

  fastify.get("/api/inventory/products", async (request, reply) => {
    const query = productListQuerySchema.parse(request.query);
    return handleInventory(reply, () => Promise.resolve(service.listProducts(request.tenant, query)));
  });

  fastify.get("/api/inventory/products/expiring", async (request, reply) => {
    const query = expiringQuerySchema.parse(request.query);
    return handleInventory(reply, () => service.listExpiringProducts(request.tenant, query.days));
  });

  fastify.put("/api/inventory/products/:id", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    const input = updateProductSchema.parse(request.body);
    return handleInventory(reply, () => service.updateProduct(request.tenant, params.id, input));
  });

  fastify.delete("/api/inventory/products/:id", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    return handleInventory(reply, () => service.deleteProduct(request.tenant, params.id));
  });

  fastify.post("/api/inventory/products/:id/batches", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    const input = addBatchSchema.parse(request.body);
    return handleInventory(reply, () => service.addBatch(request.tenant, params.id, input));
  });

  fastify.get("/api/inventory/products/:id/batches", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    return handleInventory(reply, () => Promise.resolve(service.listBatches(request.tenant, params.id)));
  });

  fastify.post("/api/inventory/stock-adjustment", async (request, reply) => {
    const input = stockAdjustmentSchema.parse(request.body);
    return handleInventory(reply, () => service.adjustStock(request.tenant, request.user, input));
  });

  // CSV export for products
  fastify.get("/api/inventory/products/export-csv", async (request, reply) => {
    const products = await fastify.prisma.product.findMany({
      where: { tenantId: request.tenant.id, isActive: true },
      orderBy: { name: "asc" },
    });
    const header = "Name,SKU,Barcode,Unit,MRP,Selling Price,Purchase Price,GST Rate,HSN Code,Current Stock,Reorder Level";
    const rows = products.map((p) => [
      p.name, p.sku ?? "", p.barcode ?? "", p.unit,
      p.mrp.toNumber(), p.sellingPrice.toNumber(), p.purchasePrice?.toNumber() ?? "",
      p.gstRate.toNumber(), p.hsnCode ?? "", p.currentStock.toNumber(), p.reorderLevel?.toNumber() ?? "",
    ].map(String).map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n");

    await reply.header("Content-Type", "text/csv").header("Content-Disposition", "attachment; filename=products.csv");
    return reply.send(`${header}\n${rows}`);
  });

  // CSV import for products
  fastify.post("/api/inventory/products/import-csv", async (request, reply) => {
    return handleInventory(reply, async () => {
      const { rows } = z.object({
        rows: z.array(z.object({
          name: z.string().min(1),
          sku: z.string().optional(),
          barcode: z.string().optional(),
          unit: z.string().default("piece"),
          mrp: z.coerce.number().nonnegative(),
          sellingPrice: z.coerce.number().nonnegative(),
          purchasePrice: z.coerce.number().nonnegative().optional(),
          gstRate: z.coerce.number().nonnegative().default(0),
          hsnCode: z.string().optional(),
          currentStock: z.coerce.number().nonnegative().default(0),
          reorderLevel: z.coerce.number().nonnegative().optional(),
        })),
      }).parse(request.body);

      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const existing = row.sku ? await fastify.prisma.product.findFirst({ where: { tenantId: request.tenant.id, sku: row.sku } }) : null;
        if (existing) {
          await fastify.prisma.product.update({ where: { id: existing.id }, data: { ...row } });
          updated++;
        } else {
          await fastify.prisma.product.create({ data: { tenantId: request.tenant.id, ...row } });
          created++;
        }
      }
      return { created, updated, total: rows.length };
    });
  });

  // Variants
  fastify.get("/api/inventory/products/:id/variants", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    return handleInventory(reply, () => Promise.resolve(fastify.prisma.productVariant.findMany({
      where: { tenantId: request.tenant.id, productId: params.id, isActive: true },
    })));
  });

  fastify.post("/api/inventory/products/:id/variants", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    const input = z.object({
      name: z.string().min(1),
      sku: z.string().optional(),
      barcode: z.string().optional(),
      sellingPrice: z.coerce.number().nonnegative(),
      purchasePrice: z.coerce.number().nonnegative().optional(),
      mrp: z.coerce.number().nonnegative(),
      currentStock: z.coerce.number().nonnegative().default(0),
      attributes: z.record(z.string()).optional(),
    }).parse(request.body);
    return handleInventory(reply, () => Promise.resolve(fastify.prisma.productVariant.create({
      data: { tenantId: request.tenant.id, productId: params.id, ...input },
    })));
  });

  done();
};

async function handleInventory<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof InventoryError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
