import type { FastifyPluginCallback, FastifyReply } from "fastify";

import {
  createPurchaseOrderSchema,
  purchaseOrderIdParamsSchema,
  purchaseOrderListQuerySchema,
  receivePurchaseOrderSchema,
  rejectPurchaseOrderSchema,
  updatePurchaseOrderStatusSchema,
} from "./purchase-orders.schema.js";
import { PurchaseOrdersError, PurchaseOrdersService } from "./purchase-orders.service.js";

export const purchaseOrdersRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new PurchaseOrdersService(fastify);

  fastify.get("/api/purchase-orders", async (request, reply) => {
    const query = purchaseOrderListQuerySchema.parse(request.query);
    return handlePurchaseOrders(reply, () => Promise.resolve(service.listPurchaseOrders(request.tenant, {
      ...query,
      ...storeIdForRead(request.user.role, request.storeId, query.storeId),
    })));
  });

  fastify.post("/api/purchase-orders", async (request, reply) => {
    const input = createPurchaseOrderSchema.parse(request.body);
    return handlePurchaseOrders(reply, () => service.createPurchaseOrder(request.tenant, {
      ...input,
      ...storeIdForWrite(request.user.role, request.storeId, input.storeId),
    }));
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

  fastify.post("/api/purchase-orders/:id/approve", async (request, reply) => {
    const params = purchaseOrderIdParamsSchema.parse(request.params);
    return handlePurchaseOrders(reply, async () => {
      const order = await service.approvePurchaseOrder(request.tenant, params.id, request.user);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "PURCHASE_ORDER_APPROVED",
          entity: "PURCHASE_ORDER",
          entityId: params.id,
          changes: { approvalStatus: "APPROVED" },
          ip: request.ip,
        },
      });
      return order;
    });
  });

  fastify.post("/api/purchase-orders/:id/reject", async (request, reply) => {
    const params = purchaseOrderIdParamsSchema.parse(request.params);
    const input = rejectPurchaseOrderSchema.parse(request.body);
    return handlePurchaseOrders(reply, async () => {
      const order = await service.rejectPurchaseOrder(request.tenant, params.id, request.user, input);
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "PURCHASE_ORDER_REJECTED",
          entity: "PURCHASE_ORDER",
          entityId: params.id,
          changes: { approvalStatus: "REJECTED", reason: input.reason },
          ip: request.ip,
        },
      });
      return order;
    });
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

function storeIdForRead(role: string, sessionStoreId: string | null | undefined, requestedStoreId: string | undefined): { storeId?: string } {
  if (role === "OWNER" || role === "MANAGER") {
    return requestedStoreId ? { storeId: requestedStoreId } : sessionStoreId ? { storeId: sessionStoreId } : {};
  }

  return sessionStoreId ? { storeId: sessionStoreId } : requestedStoreId ? { storeId: requestedStoreId } : {};
}

function storeIdForWrite(role: string, sessionStoreId: string | null | undefined, requestedStoreId: string | undefined): { storeId?: string } {
  if (role === "OWNER" || role === "MANAGER") {
    return requestedStoreId ? { storeId: requestedStoreId } : sessionStoreId ? { storeId: sessionStoreId } : {};
  }

  return sessionStoreId ? { storeId: sessionStoreId } : {};
}
