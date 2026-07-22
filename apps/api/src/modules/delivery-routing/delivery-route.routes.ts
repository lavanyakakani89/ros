import { UserRole } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";

import {
  createDeliveryRoutePlanSchema,
  deliveryLocationParamsSchema,
  deliveryRoutePlanParamsSchema,
  deliveryRouteStopParamsSchema,
  geocodeBatchSchema,
  patchDeliveryRoutePlanSchema,
  patchDeliveryRouteStopSchema,
  updateDeliveryLocationSchema,
} from "./delivery-route.schema.js";
import { DeliveryRouteError, DeliveryRouteService, type DeliveryRouteActor } from "./delivery-route.service.js";

export const deliveryRouteRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = DeliveryRouteService.fromFastify(fastify);

  fastify.get("/api/delivery-route-plans", async (request) => {
    return service.listPlans(request.tenant);
  });

  fastify.post("/api/delivery-route-plans", async (request, reply) => {
    const input = createDeliveryRoutePlanSchema.parse(request.body);
    return handleRoute(reply, () => service.createPlan(request.tenant, getActor(request), input));
  });

  fastify.get("/api/delivery-route-plans/:id", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.getPlan(request.tenant, params.id));
  });

  fastify.get("/api/delivery-route-plans/:id/status", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, async () => {
      const plan = await service.getPlan(request.tenant, params.id);
      return {
        routePlanId: plan.id,
        status: plan.status,
        provider: plan.provider,
        providerError: plan.providerError,
      };
    });
  });

  fastify.patch("/api/delivery-route-plans/:id", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    const input = patchDeliveryRoutePlanSchema.parse(request.body);
    return handleRoute(reply, () => service.patchPlan(request.tenant, params.id, input));
  });

  fastify.post("/api/delivery-route-plans/:id/optimize", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, async () => {
      await service.queueOptimization(request.tenant, params.id);
      return reply.status(202).send({
        routePlanId: params.id,
        status: "QUEUED",
      });
    });
  });

  fastify.post("/api/delivery-route-plans/:id/apply", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.applyPlan(request.tenant, params.id));
  });

  fastify.post("/api/delivery-route-plans/:id/publish", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.publishPlan(request.tenant, params.id));
  });

  fastify.post("/api/delivery-route-plans/:id/reoptimize", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, async () => {
      await service.queueOptimization(request.tenant, params.id);
      return reply.status(202).send({
        routePlanId: params.id,
        status: "QUEUED",
      });
    });
  });

  fastify.post("/api/delivery-route-plans/:id/cancel", async (request, reply) => {
    const params = deliveryRoutePlanParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.cancelPlan(request.tenant, params.id));
  });

  fastify.patch("/api/delivery-route-plans/:id/stops/:stopId", async (request, reply) => {
    const params = deliveryRouteStopParamsSchema.parse(request.params);
    const input = patchDeliveryRouteStopSchema.parse(request.body);
    return handleRoute(reply, () => service.patchStop(request.tenant, params.id, params.stopId, input));
  });

  fastify.post("/api/delivery-route-plans/:id/stops/:stopId/lock", async (request, reply) => {
    const params = deliveryRouteStopParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.lockStop(request.tenant, params.id, params.stopId, true));
  });

  fastify.post("/api/delivery-route-plans/:id/stops/:stopId/unlock", async (request, reply) => {
    const params = deliveryRouteStopParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.lockStop(request.tenant, params.id, params.stopId, false));
  });

  fastify.post("/api/deliveries/:id/geocode", async (request, reply) => {
    const params = deliveryLocationParamsSchema.parse(request.params);
    return handleRoute(reply, () => service.geocodeDelivery(request.tenant, params.id));
  });

  fastify.post("/api/deliveries/geocode-batch", async (request, reply) => {
    const input = geocodeBatchSchema.parse(request.body);
    return handleRoute(reply, () => service.geocodeBatch(request.tenant, input.deliveryIds));
  });

  fastify.patch("/api/deliveries/:id/location", async (request, reply) => {
    const params = deliveryLocationParamsSchema.parse(request.params);
    const input = updateDeliveryLocationSchema.parse(request.body);
    return handleRoute(reply, () => service.updateDeliveryLocation(request.tenant, getActor(request), params.id, input));
  });

  fastify.get("/api/delivery/me/route", async (request, reply) => {
    return handleRoute(reply, () => Promise.resolve(service.getMyRoute(request.tenant, getActor(request))));
  });

  fastify.get("/api/delivery/me/route/next-stop", async (request, reply) => {
    return handleRoute(reply, () => service.getMyNextStop(request.tenant, getActor(request)));
  });

  fastify.post("/api/delivery/me/route/start", async (request, reply) => {
    return handleRoute(reply, () => Promise.resolve(service.startMyRoute(request.tenant, getActor(request))));
  });

  fastify.post("/api/delivery/me/route/stops/:stopId/complete", async (request, reply) => {
    const params = deliveryRouteStopParamsSchema.pick({ stopId: true }).parse(request.params);
    return handleRoute(reply, () => Promise.resolve(service.completeMyStop(request.tenant, getActor(request), params.stopId)));
  });

  fastify.post("/api/delivery/me/route/stops/:stopId/fail", async (request, reply) => {
    const params = deliveryRouteStopParamsSchema.pick({ stopId: true }).parse(request.params);
    return handleRoute(reply, () => Promise.resolve(service.failMyStop(request.tenant, getActor(request), params.stopId)));
  });

  done();
};

function getActor(request: FastifyRequest): DeliveryRouteActor {
  const user = request.user as { userId?: string; role?: UserRole } | undefined;
  return {
    userId: user?.userId ?? "",
    role: user?.role ?? UserRole.STAFF,
  };
}

async function handleRoute<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof DeliveryRouteError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
