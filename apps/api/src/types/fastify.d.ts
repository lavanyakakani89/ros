import type { PrismaClient, Tenant, UserRole } from "@prisma/client";
import type { FastifyReply, FastifyRequest as BaseFastifyRequest } from "fastify";
import type { Client } from "minio";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    minio: Client;
    minioBucket: string;
    authenticate: (request: BaseFastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    tenant: Tenant;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      userId: string;
      tenantId: string;
      role: UserRole;
    };
    user: {
      userId: string;
      tenantId: string;
      role: UserRole;
    };
  }
}
