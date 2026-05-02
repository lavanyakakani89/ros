import { Redis } from "ioredis";

export function createQueueConnection() {
  return new Redis(process.env.REDIS_URL ?? "redis://:password@localhost:6379", {
    maxRetriesPerRequest: null,
  });
}
