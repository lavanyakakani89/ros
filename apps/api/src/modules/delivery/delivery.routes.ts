import type { FastifyPluginCallback, FastifyReply } from "fastify";

import {
  assignDeliverySchema,
  createDeliverySchema,
  deliveryAgentParamsSchema,
  deliveryIdParamsSchema,
  deliveryListQuerySchema,
  updateDeliveryStatusSchema,
} from "./delivery.schema.js";
import { DeliveryError, DeliveryService } from "./delivery.service.js";

export const deliveryRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new DeliveryService(fastify);

  fastify.post("/api/delivery", async (request, reply) => {
    const input = createDeliverySchema.parse(request.body);
    return handleDelivery(reply, () => service.createDelivery(request.tenant, input));
  });

  fastify.get("/api/delivery", async (request, reply) => {
    const query = deliveryListQuerySchema.parse(request.query);
    return handleDelivery(reply, () => Promise.resolve(service.listDeliveries(request.tenant, query)));
  });

  fastify.post("/api/delivery/:id/assign", async (request, reply) => {
    const params = deliveryIdParamsSchema.parse(request.params);
    const input = assignDeliverySchema.parse(request.body);
    return handleDelivery(reply, () => service.assignDelivery(request.tenant, params.id, input));
  });

  fastify.put("/api/delivery/:id/status", async (request, reply) => {
    const params = deliveryIdParamsSchema.parse(request.params);
    const input = updateDeliveryStatusSchema.parse(request.body);
    return handleDelivery(reply, () => service.updateStatus(request.tenant, params.id, input));
  });

  fastify.get("/api/delivery/agent/:userId", async (request, reply) => {
    const params = deliveryAgentParamsSchema.parse(request.params);
    return handleDelivery(reply, () => Promise.resolve(service.listAgentDeliveries(request.tenant, params.userId)));
  });

  done();
};

async function handleDelivery<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof DeliveryError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
