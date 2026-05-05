import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { InventoryError, InventoryService } from "./inventory.service.js";
import { importProducts, sendProductExport, sendProductTemplate } from "../import-export/product-import-export.js";
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

  fastify.get("/api/inventory/products/template", async (request, reply) => {
    return sendProductTemplate(request.tenant, reply);
  });

  fastify.get("/api/inventory/products/export", async (request, reply) => {
    return sendProductExport(fastify, request.tenant, reply);
  });

  fastify.post("/api/inventory/products/import", async (request, reply) => {
    return handleInventory(reply, async () => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "Upload an Excel file." });
      }

      const buffer = await file.toBuffer();
      return importProducts(fastify, request.tenant, buffer);
    });
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
      data: {
        tenantId: request.tenant.id,
        productId: params.id,
        name: input.name,
        sku: input.sku ?? null,
        barcode: input.barcode ?? null,
        sellingPrice: input.sellingPrice,
        purchasePrice: input.purchasePrice ?? null,
        mrp: input.mrp,
        currentStock: input.currentStock,
        attributes: input.attributes ?? Prisma.JsonNull,
      },
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
