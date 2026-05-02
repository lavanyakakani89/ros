import "dotenv/config";

export interface ApiEnv {
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  port: number;
  host: string;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getEnv(): ApiEnv {
  return {
    databaseUrl: readRequiredEnv("DATABASE_URL"),
    redisUrl: readRequiredEnv("REDIS_URL"),
    jwtSecret: readRequiredEnv("JWT_SECRET"),
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? "0.0.0.0",
  };
}
