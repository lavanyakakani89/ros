import type { Tenant } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";

import { verifyRequestJwt } from "./auth.js";

const tenantCacheTtlSeconds = 300;
const publicRoutePrefixes = [
  "/health",
  "/api/health",
  "/metrics",
  "/api/auth/",
  "/api/superadmin/",
  "/api/payments/razorpay/webhook",
];

const tenantPluginCallback: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.addHook("preHandler", async (request, reply) => {
    if (isPublicRoute(request.url)) {
      return;
    }

    try {
      verifyRequestJwt(fastify, request);
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const user = request.user as { tenantId?: string } | undefined;
    const tenantId = user?.tenantId;

    if (!tenantId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const cacheKey = `tenant:${tenantId}`;
    const cachedTenant = await fastify.redis.get(cacheKey);
    let tenant: Tenant | null = cachedTenant ? (JSON.parse(cachedTenant) as Tenant) : null;

    if (!tenant) {
      tenant = await fastify.prisma.tenant.findUnique({
        where: {
          id: tenantId,
        },
      });

      if (!tenant) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      await fastify.redis.set(cacheKey, JSON.stringify(tenant), "EX", tenantCacheTtlSeconds);
    }

    if (tenant.status === "SUSPENDED") {
      return reply.status(403).send({
        error: "Account suspended",
        code: "TENANT_SUSPENDED",
        message: "This shop is suspended. Contact your RetailOS administrator to reactivate access.",
      });
    }

    request.tenant = tenant;
    await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, FALSE)`;
  });

  done();
};

export const tenantPlugin = fp(tenantPluginCallback);

function isPublicRoute(url: string): boolean {
  return publicRoutePrefixes.some((prefix) => url === prefix || url.startsWith(prefix));
}
