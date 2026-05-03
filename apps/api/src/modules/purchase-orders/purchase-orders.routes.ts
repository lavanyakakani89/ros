import type { FastifyPluginCallback, FastifyReply } from "fastify";

import {
  createPurchaseOrderSchema,
  purchaseOrderIdParamsSchema,
  purchaseOrderListQuerySchema,
  receivePurchaseOrderSchema,
  updatePurchaseOrderStatusSchema,
} from "./purchase-orders.schema.js";
import { PurchaseOrdersError, PurchaseOrdersService } from "./purchase-orders.service.js";

export const purchaseOrdersRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new PurchaseOrdersService(fastify);

  fastify.get("/api/purchase-orders", async (request, reply) => {
    const query = purchaseOrderListQuerySchema.parse(request.query);
    return handlePurchaseOrders(reply, () => Promise.resolve(service.listPurchaseOrders(request.tenant, query)));
  });

  fastify.post("/api/purchase-orders", async (request, reply) => {
    const input = createPurchaseOrderSchema.parse(request.body);
    return handlePurchaseOrders(reply, () => service.createPurchaseOrder(request.tenant, input));
  });

  fastify.get("/api/purchase-orders/:id", async (request, reply) => {
    const params = purchaseOrderIdParamsSchema.parse(request.params);
    return handlePurchaseOrders(reply, () => service.getPurchaseOrder(request.tenant, params.id));
  });

  fastify.put("/api/purchase-orders/:id/status", async (request, reply) => {
    const params = purchaseOrderIdParamsSchema.parse(request.params);
    const input = updatePurchaseOrderStatusSchema.parse(request.body);
    return handlePurchaseOrders(reply, () => service.updateStatus(request.tenant, params.id, input));
  });

  fastify.post("/api/purchase-orders/:id/receive", async (request, reply) => {
    const params = purchaseOrderIdParamsSchema.parse(request.params);
    const input = receivePurchaseOrderSchema.parse(request.body);
    return handlePurchaseOrders(reply, () => service.receivePurchaseOrder(request.tenant, params.id, input));
  });

  done();
};

async function handlePurchaseOrders<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof PurchaseOrdersError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
