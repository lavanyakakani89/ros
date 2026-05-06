import type { PrismaClient, SuperAdminRole, Tenant, UserRole } from "@prisma/client";
import type { FastifyReply, FastifyRequest as BaseFastifyRequest } from "fastify";
import type { Client } from "minio";
import type { Redis } from "ioredis";

import type { RequestImpersonationContext } from "../plugins/impersonation.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    minio: Client;
    minioBucket: string;
    authenticate: (request: BaseFastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    rawBody?: string;
    tenant: Tenant;
    superAdmin?: {
      id: string;
      name: string;
      email: string;
      role: SuperAdminRole;
      sessionId: string;
    };
    isImpersonated?: boolean;
    impersonation?: RequestImpersonationContext;
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
