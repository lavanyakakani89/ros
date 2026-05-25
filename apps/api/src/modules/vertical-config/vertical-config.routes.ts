import type { FastifyPluginCallback } from "fastify";

import { currentVerticalConfigParamsSchema } from "./vertical-config.schema.js";
import { VerticalConfigService } from "./vertical-config.service.js";

export const verticalConfigRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new VerticalConfigService();

  fastify.get("/api/vertical-config/current", async (request) => {
    currentVerticalConfigParamsSchema.parse(request.params);
    const user = request.isImpersonated
      ? null
      : await fastify.prisma.user.findFirst({
          where: {
            id: request.user.userId,
            tenantId: request.user.tenantId,
            role: request.user.role,
            isActive: true,
          },
          select: {
            id: true,
            tenantId: true,
            name: true,
            email: true,
            role: true,
          },
        });

    return {
      ...service.getCurrentTenantConfig(request.tenant),
      user: user
        ? {
            id: user.id,
            tenantId: user.tenantId,
            name: user.name,
            email: user.email,
            role: user.role,
            storeId: null,
          }
        : null,
      isImpersonated: Boolean(request.isImpersonated),
      impersonation: request.impersonation ?? null,
    };
  });

  done();
};
