import IORedis from "ioredis";

export function createQueueConnection() {
  return new IORedis(process.env.REDIS_URL ?? "redis://:password@localhost:6379", {
    maxRetriesPerRequest: null,
  });
}
