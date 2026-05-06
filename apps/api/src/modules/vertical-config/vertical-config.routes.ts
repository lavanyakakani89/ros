import type { FastifyPluginCallback } from "fastify";

import { currentVerticalConfigParamsSchema } from "./vertical-config.schema.js";
import { VerticalConfigService } from "./vertical-config.service.js";

export const verticalConfigRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new VerticalConfigService();

  fastify.get("/api/vertical-config/current", (request) => {
    currentVerticalConfigParamsSchema.parse(request.params);
    return {
      ...service.getCurrentTenantConfig(request.tenant),
      isImpersonated: Boolean(request.isImpersonated),
      impersonation: request.impersonation ?? null,
    };
  });

  done();
};
