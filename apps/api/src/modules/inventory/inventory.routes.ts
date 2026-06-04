import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { InventoryError, InventoryService } from "./inventory.service.js";
import { ProductImageDiscoveryService } from "./product-image-discovery.service.js";
import { importProducts, sendProductExport, sendProductTemplate } from "../import-export/product-import-export.js";
import {
  addBatchSchema,
  createProductSchema,
  expiringQuerySchema,
  productIdParamsSchema,
  productListQuerySchema,
  productLookupQuerySchema,
  stockAdjustmentSchema,
  stockMovementQuerySchema,
  updateProductSchema,
} from "./inventory.schema.js";

export const inventoryRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new InventoryService(fastify);
  const imageDiscovery = new ProductImageDiscoveryService(fastify);
  const productExportQuerySchema = z.object({
    format: z.enum(["csv", "xls"]).optional().default("xls"),
  });
  const imageSuggestionParamsSchema = productIdParamsSchema.extend({
    suggestionId: z.string().min(1),
  });
  const imageSuggestionSearchSchema = z.object({
    limit: z.coerce.number().int().min(1).max(10).optional().default(6),
  });

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
    const query = productExportQuerySchema.parse(request.query);
    return sendProductExport(fastify, request.tenant, reply, query.format);
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

  fastify.get("/api/inventory/products/lookup", async (request, reply) => {
    const query = productLookupQuerySchema.parse(request.query);
    return handleInventory(reply, () => service.lookupProduct(request.tenant, query));
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

  fastify.get("/api/inventory/products/:id/movements", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    const query = stockMovementQuerySchema.parse(request.query);
    return handleInventory(reply, () => service.listProductMovements(request.tenant, params.id, query));
  });

  fastify.get("/api/inventory/products/:id/stock-history", async (request, reply) => {
    const params = productIdParamsSchema.parse(request.params);
    const query = stockMovementQuerySchema.parse(request.query);
    return handleInventory(reply, () => service.listProductMovements(request.tenant, params.id, query));
  });

  fastify.get("/api/inventory/products/:id/image", async (request, reply) => {
    return handleInventory(reply, async () => {
      const params = productIdParamsSchema.parse(request.params);
      const product = await fastify.prisma.product.findFirst({
        where: {
          id: params.id,
          tenantId: request.tenant.id,
          isActive: true,
        },
        select: {
          imageUrl: true,
        },
      });

      if (!product?.imageUrl) {
        throw new InventoryError("Product image not found", 404);
      }

      const stream = await fastify.minio.getObject(fastify.minioBucket, product.imageUrl);
      reply.header("Cache-Control", "private, max-age=300");
      reply.type(contentTypeForImageObject(product.imageUrl));
      return reply.send(stream);
    });
  });

  fastify.post("/api/inventory/products/:id/image", async (request, reply) => {
    return handleInventory(reply, async () => {
      ensureProductImageManager(request.user.role);
      const params = productIdParamsSchema.parse(request.params);
      const product = await fastify.prisma.product.findFirst({
        where: {
          id: params.id,
          tenantId: request.tenant.id,
          isActive: true,
        },
        select: {
          id: true,
          imageUrl: true,
        },
      });

      if (!product) {
        throw new InventoryError("Product not found", 404);
      }

      const file = await request.file();
      if (!file) {
        throw new InventoryError("Product image file is required", 400);
      }

      const contentType = file.mimetype.toLowerCase();
      if (!allowedProductImageTypes.has(contentType)) {
        throw new InventoryError("Upload a JPG, PNG, or WEBP image", 400);
      }

      const buffer = await file.toBuffer();
      if (buffer.length > maxProductImageBytes) {
        throw new InventoryError("Product image must be 350 KB or smaller. Recommended size is 800 x 800 JPG or WEBP.", 400);
      }

      const extension = extensionForContentType(contentType);
      const objectName = `products/${request.tenant.id}/${params.id}.${extension}`;
      await fastify.minio.putObject(fastify.minioBucket, objectName, buffer, buffer.length, {
        "Content-Type": contentType,
      });

      if (product.imageUrl && product.imageUrl !== objectName) {
        await fastify.minio.removeObject(fastify.minioBucket, product.imageUrl).catch(() => undefined);
      }

      await fastify.prisma.product.update({
        where: {
          id: params.id,
        },
        data: {
          imageUrl: objectName,
        },
      });

      return {
        imageUrl: productImageViewUrl(params.id),
      };
    });
  });

  fastify.delete("/api/inventory/products/:id/image", async (request, reply) => {
    return handleInventory(reply, async () => {
      ensureProductImageManager(request.user.role);
      const params = productIdParamsSchema.parse(request.params);
      const product = await fastify.prisma.product.findFirst({
        where: {
          id: params.id,
          tenantId: request.tenant.id,
          isActive: true,
        },
        select: {
          imageUrl: true,
        },
      });

      if (!product) {
        throw new InventoryError("Product not found", 404);
      }

      if (product.imageUrl) {
        await fastify.minio.removeObject(fastify.minioBucket, product.imageUrl).catch(() => undefined);
      }

      await fastify.prisma.product.update({
        where: {
          id: params.id,
        },
        data: {
          imageUrl: null,
        },
      });

      return {
        imageUrl: null,
      };
    });
  });

  fastify.get("/api/inventory/products/:id/image-suggestions", async (request, reply) => {
    return handleInventory(reply, async () => {
      ensureProductImageManager(request.user.role);
      const params = productIdParamsSchema.parse(request.params);
      const suggestions = await imageDiscovery.listSuggestions(request.tenant.id, params.id);
      return {
        configured: imageDiscovery.isConfigured(),
        suggestions,
      };
    });
  });

  fastify.post("/api/inventory/products/:id/image-suggestions/search", async (request, reply) => {
    return handleInventory(reply, async () => {
      ensureProductImageManager(request.user.role);
      const params = productIdParamsSchema.parse(request.params);
      const input = imageSuggestionSearchSchema.parse(request.body ?? {});
      if (!imageDiscovery.isConfigured()) {
        const suggestions = await imageDiscovery.listSuggestions(request.tenant.id, params.id);
        return {
          configured: false,
          suggestions,
        };
      }
      const suggestions = await imageDiscovery.searchSuggestions(request.tenant, params.id, input.limit);
      return {
        configured: true,
        suggestions,
      };
    });
  });

  fastify.post("/api/inventory/products/:id/image-suggestions/:suggestionId/apply", async (request, reply) => {
    return handleInventory(reply, async () => {
      ensureProductImageManager(request.user.role);
      const params = imageSuggestionParamsSchema.parse(request.params);
      return imageDiscovery.approveSuggestion(request.tenant.id, params.id, params.suggestionId, request.user.userId);
    });
  });

  fastify.post("/api/inventory/products/:id/image-suggestions/:suggestionId/reject", async (request, reply) => {
    return handleInventory(reply, async () => {
      ensureProductImageManager(request.user.role);
      const params = imageSuggestionParamsSchema.parse(request.params);
      return imageDiscovery.rejectSuggestion(request.tenant.id, params.id, params.suggestionId);
    });
  });

  fastify.post("/api/inventory/stock-adjustment", async (request, reply) => {
    const parsed = stockAdjustmentSchema.parse(request.body);
    const rawQuantity = parsed.direction ? parsed.quantity ?? parsed.quantityChange : parsed.quantityChange;
    if (rawQuantity === undefined || rawQuantity === 0) {
      return reply.status(400).send({ error: "Quantity is required" });
    }
    const quantityChange = parsed.direction === "REMOVE"
      ? -Math.abs(rawQuantity)
      : parsed.direction === "ADD"
        ? Math.abs(rawQuantity)
        : rawQuantity;
    const input = {
      productId: parsed.productId,
      quantityChange,
      reason: parsed.reason,
      ...(parsed.notes ? { notes: parsed.notes } : {}),
    };
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

const maxProductImageBytes = 350 * 1024;
const allowedProductImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function ensureProductImageManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new InventoryError("Only owners and managers can manage product images", 403);
  }
}

function extensionForContentType(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function contentTypeForImageObject(objectName: string): string {
  if (objectName.endsWith(".png")) return "image/png";
  if (objectName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function productImageViewUrl(productId: string): string {
  return `/api/inventory/products/${productId}/image`;
}
