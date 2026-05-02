import type { Tenant } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";

const tenantCacheTtlSeconds = 300;
const publicRoutePrefixes = ["/health", "/api/health", "/metrics", "/api/auth/"];

const tenantPluginCallback: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.addHook("preHandler", async (request, reply) => {
    if (isPublicRoute(request.url)) {
      return;
    }

    try {
      await request.jwtVerify();
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

    request.tenant = tenant;
    await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
  });

  done();
};

export const tenantPlugin = fp(tenantPluginCallback);

function isPublicRoute(url: string): boolean {
  return publicRoutePrefixes.some((prefix) => url === prefix || url.startsWith(prefix));
}
