import fp from "fastify-plugin";
import { Redis } from "ioredis";

import { getEnv } from "../config/env.js";

export const redisPlugin = fp(async (fastify) => {
  const env = getEnv();
  const redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 3,
  });

  await redis.ping();

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
  });
});
