import Fastify, { type FastifyInstance } from "fastify";

import { authPlugin } from "./plugins/auth.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { minioPlugin } from "./plugins/minio.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { tenantPlugin } from "./plugins/tenant.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { deliveryRoutes } from "./modules/delivery/delivery.routes.js";
import { inventoryRoutes } from "./modules/inventory/inventory.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { verticalConfigRoutes } from "./modules/vertical-config/vertical-config.routes.js";

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(minioPlugin);
  await fastify.register(metricsPlugin);
  await fastify.register(authPlugin);
  await fastify.register(authRoutes);

  async function getHealth() {
    await Promise.all([fastify.prisma.$queryRaw`SELECT 1`, fastify.redis.ping()]);

    return {
      status: "ok",
      services: {
        database: "ok",
        redis: "ok",
      },
    };
  }

  fastify.get("/health", async () => {
    return getHealth();
  });

  fastify.get("/api/health", async () => {
    return getHealth();
  });

  await fastify.register(tenantPlugin);
  await fastify.register(verticalConfigRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(billingRoutes);
  await fastify.register(paymentsRoutes);
  await fastify.register(deliveryRoutes);

  return fastify;
}
