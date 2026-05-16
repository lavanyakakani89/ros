import { randomBytes } from "node:crypto";

import { verify } from "@node-rs/argon2";
import type { ImpersonationAccessLevel, ImpersonationEndReason, Prisma, Tenant } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";

export const impersonationTtlMs = 2 * 60 * 60 * 1000;

export interface RequestImpersonationContext {
  sessionId: string;
  accessLevel: ImpersonationAccessLevel;
  reason: string | null;
  expiresAt: string;
  superAdminId: string;
  superAdminName: string;
  superAdminEmail: string;
}

export interface VerifiedImpersonationSession {
  id: string;
  tenant: Tenant;
  accessLevel: ImpersonationAccessLevel;
  reason: string | null;
  expiresAt: Date;
  superAdmin: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
  };
}

type ImpersonationSessionWithRelations = Prisma.ImpersonationSessionGetPayload<{
  include: {
    tenant: true;
    superAdmin: {
      select: {
        id: true;
        name: true;
        email: true;
        role: true;
        isActive: true;
      };
    };
  };
}>;

export class ImpersonationAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401,
    public readonly code = "IMPERSONATION_INVALID",
  ) {
    super(message);
  }
}

export function createImpersonationSecret(): string {
  return randomBytes(64).toString("base64url");
}

export async function resolveImpersonationFromHeader(
  fastify: FastifyInstance,
  request: FastifyRequest,
): Promise<VerifiedImpersonationSession | null> {
  const rawHeader = request.headers["x-impersonation-token"];
  const token = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!token) {
    return null;
  }

  return verifyImpersonationToken(fastify, token);
}

export async function verifyImpersonationToken(fastify: FastifyInstance, cookieValue: string): Promise<VerifiedImpersonationSession> {
  const { sessionId, secret } = parseImpersonationToken(cookieValue);
  const session = await fastify.prisma.impersonationSession.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      tenant: true,
      superAdmin: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
  });

  if (!session?.tokenHash) {
    throw new ImpersonationAuthError("Impersonation session is no longer active", 401, "IMPERSONATION_ENDED");
  }

  const now = new Date();
  if (session.endedAt) {
    throw new ImpersonationAuthError("Impersonation session is no longer active", 401, "IMPERSONATION_ENDED");
  }

  if (session.expiresAt <= now) {
    await endExpiredSession(fastify, session.id);
    throw new ImpersonationAuthError("Impersonation session expired", 401, "IMPERSONATION_EXPIRED");
  }

  if (!session.superAdmin.isActive) {
    throw new ImpersonationAuthError("Super-admin is no longer active", 401, "IMPERSONATION_ADMIN_INACTIVE");
  }

  if (session.tenant.status === "SUSPENDED") {
    throw new ImpersonationAuthError("Shop is suspended", 403, "TENANT_SUSPENDED");
  }

  if (!(await verify(session.tokenHash, secret))) {
    throw new ImpersonationAuthError("Invalid impersonation session", 401, "IMPERSONATION_INVALID");
  }

  return toVerifiedSession(session);
}

export function toRequestImpersonationContext(session: VerifiedImpersonationSession): RequestImpersonationContext {
  return {
    sessionId: session.id,
    accessLevel: session.accessLevel,
    reason: session.reason,
    expiresAt: session.expiresAt.toISOString(),
    superAdminId: session.superAdmin.id,
    superAdminName: session.superAdmin.name,
    superAdminEmail: session.superAdmin.email,
  };
}

export function requestIp(request: FastifyRequest): string | undefined {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim();
  }

  return request.ip;
}

export function requestUserAgent(request: FastifyRequest): string | undefined {
  const userAgent = request.headers["user-agent"];
  return Array.isArray(userAgent) ? userAgent.join(" ") : userAgent;
}

async function endExpiredSession(fastify: FastifyInstance, sessionId: string): Promise<void> {
  await fastify.prisma.impersonationSession.updateMany({
    where: {
      id: sessionId,
      endedAt: null,
    },
    data: {
      endedAt: new Date(),
      endReason: "EXPIRED" satisfies ImpersonationEndReason,
      tokenHash: null,
    },
  });
}

function parseImpersonationToken(cookieValue: string): { sessionId: string; secret: string } {
  const separatorIndex = cookieValue.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === cookieValue.length - 1) {
    throw new ImpersonationAuthError("Invalid impersonation session");
  }

  return {
    sessionId: cookieValue.slice(0, separatorIndex),
    secret: cookieValue.slice(separatorIndex + 1),
  };
}

function toVerifiedSession(session: ImpersonationSessionWithRelations): VerifiedImpersonationSession {
  return {
    id: session.id,
    tenant: session.tenant,
    accessLevel: session.accessLevel,
    reason: session.reason,
    expiresAt: session.expiresAt,
    superAdmin: session.superAdmin,
  };
}
