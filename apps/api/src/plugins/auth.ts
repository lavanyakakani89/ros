import jwt from "@fastify/jwt";
import fp from "fastify-plugin";

import { getEnv } from "../config/env.js";

export const authPlugin = fp(async (fastify) => {
  const env = getEnv();

  await fastify.register(jwt, {
    secret: env.jwtSecret,
  });

  fastify.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.status(401).send({ error: "Unauthorized" });
    }
  });
});
