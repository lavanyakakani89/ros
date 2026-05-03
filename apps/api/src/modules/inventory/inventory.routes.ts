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
