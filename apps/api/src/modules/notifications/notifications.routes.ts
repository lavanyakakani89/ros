import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";

const registerPushTokenSchema = z.object({
  token: z.string().trim().min(1),
  platform: z.string().trim().min(1).default("android"),
});

const unregisterPushTokenSchema = z.object({
  token: z.string().trim().min(1),
});

export const notificationsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.post("/api/notifications/register", async (request) => {
    const input = registerPushTokenSchema.parse(request.body);
    await fastify.prisma.expoPushToken.upsert({
      where: { token: input.token },
      create: {
        token: input.token,
        platform: input.platform,
        userId: request.user.userId,
        tenantId: request.tenant.id,
      },
      update: {
        platform: input.platform,
        userId: request.user.userId,
        tenantId: request.tenant.id,
      },
    });

    return { registered: true };
  });

  fastify.delete("/api/notifications/register", async (request) => {
    const input = unregisterPushTokenSchema.parse(request.body);
    await fastify.prisma.expoPushToken.deleteMany({
      where: {
        token: input.token,
        userId: request.user.userId,
      },
    });

    return { unregistered: true };
  });

  done();
};
