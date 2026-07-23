import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { changePasswordSchema, createUserSchema, updateTenantSchema, updateUserSchema, userIdParamsSchema } from "./settings.schema.js";
import { SettingsError, SettingsService } from "./settings.service.js";

export const settingsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new SettingsService(fastify);

  fastify.get("/api/settings/current", async (request) => {
    return service.getCurrentTenant(request.tenant);
  });

  fastify.put("/api/settings/tenant", async (request, reply) => {
    const input = updateTenantSchema.parse(request.body);
    return handleSettings(reply, () => service.updateTenant(request.tenant, input));
  });

  fastify.get("/api/settings/users", async (request) => {
    return service.listUsers(request.tenant);
  });

  fastify.post("/api/settings/users", async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    return handleSettings(reply, () => service.createUser(request.tenant, request.user, input));
  });

  fastify.put("/api/settings/users/:id", async (request, reply) => {
    const params = userIdParamsSchema.parse(request.params);
    const input = updateUserSchema.parse(request.body);
    return handleSettings(reply, () => service.updateUser(request.tenant, request.user, params.id, input));
  });

  fastify.delete("/api/settings/users/:id", async (request, reply) => {
    const params = userIdParamsSchema.parse(request.params);
    return handleSettings(reply, () => service.deleteUser(request.tenant, request.user, params.id));
  });

  fastify.put("/api/settings/password", async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    return handleSettings(reply, () => service.changePassword(request.tenant, request.user, input));
  });

  done();
};

async function handleSettings<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SettingsError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
