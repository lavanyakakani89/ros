import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { AuthError, AuthService } from "./auth.service.js";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "./auth.schema.js";

export const authRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const authService = new AuthService(fastify);

  fastify.post("/api/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    return handleAuth(reply, () => authService.register(input));
  });

  fastify.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    return handleAuth(reply, () => authService.login(input));
  });

  fastify.post("/api/auth/refresh", async (request, reply) => {
    const input = refreshSchema.parse(request.body);
    return handleAuth(reply, () => authService.refresh(input));
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    const input = logoutSchema.parse(request.body);
    return handleAuth(reply, async () => {
      await authService.logout(input);
      return { status: "ok" };
    });
  });
  done();
};

async function handleAuth<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AuthError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
