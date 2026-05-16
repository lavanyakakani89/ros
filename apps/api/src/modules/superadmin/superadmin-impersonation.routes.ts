import { hash } from "@node-rs/argon2";
import { ImpersonationAccessLevel, ImpersonationEndReason, SuperAdminRole } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createImpersonationSecret,
  impersonationTtlMs,
  requestIp,
  requestUserAgent,
  resolveImpersonationFromHeader,
  verifyImpersonationToken,
} from "../../plugins/impersonation.js";
import { requireRole, requireSuperAdmin } from "./superadmin-auth.routes.js";

const maxActiveImpersonationSessions = 10;

const tenantParamsSchema = z.object({
  tenantId: z.string().min(1),
});

const sessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const startImpersonationSchema = z.object({
  accessLevel: z.nativeEnum(ImpersonationAccessLevel).default(ImpersonationAccessLevel.READ_ONLY),
  reason: z.string().trim().max(500).optional(),
});

const endImpersonationSchema = z.object({
  sessionId: z.string().min(1),
});

const verifyImpersonationSchema = z.object({
  token: z.string().min(1),
  sessionId: z.string().min(1),
});

const listSessionsSchema = z.object({
  active: z.enum(["true", "false", "all"]).default("true"),
  tenantId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const superAdminImpersonationRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/superadmin/impersonate/sessions", { preHandler: requireSuperAdmin }, async (request) => {
    const query = listSessionsSchema.parse(request.query);
    const now = new Date();
    const where: Prisma.ImpersonationSessionWhereInput = {};

    if (query.tenantId) {
      where.tenantId = query.tenantId;
    }

    if (query.active === "true") {
      where.endedAt = null;
      where.expiresAt = {
        gt: now,
      };
    }

    if (query.active === "false") {
      where.OR = [
        {
          endedAt: {
            not: null,
          },
        },
        {
          expiresAt: {
            lte: now,
          },
        },
      ];
    }

    const sessions = await fastify.prisma.impersonationSession.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      take: query.limit,
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            vertical: true,
            status: true,
          },
        },
        superAdmin: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return { sessions: sessions.map(formatSession) };
  });

  fastify.post("/api/superadmin/impersonate/end", async (request, reply) => {
    const input = endImpersonationSchema.parse(request.body ?? {});
    const session = await resolveImpersonationFromHeader(fastify, request).catch(() => null);
    if (!session) {
      return reply.status(401).send({ error: "No active impersonation session", code: "IMPERSONATION_REQUIRED" });
    }

    if (session.id !== input.sessionId) {
      return reply.status(401).send({ error: "Invalid impersonation session", code: "IMPERSONATION_INVALID" });
    }

    await endSession(request, session.id, ImpersonationEndReason.EXIT);
    return { status: "ok" };
  });

  fastify.post("/api/superadmin/impersonate/verify", async (request, reply) => {
    const input = verifyImpersonationSchema.parse(request.body ?? {});

    try {
      const session = await verifyImpersonationToken(fastify, input.token);
      if (session.id !== input.sessionId) {
        return await reply.status(401).send({ valid: false, error: "Invalid or expired" });
      }

      return {
        valid: true,
        tenantName: session.tenant.name,
        superAdminEmail: session.superAdmin.email,
        superAdminName: session.superAdmin.name,
        accessLevel: session.accessLevel,
        expiresAt: session.expiresAt,
        sessionId: session.id,
      };
    } catch {
      return await reply.status(401).send({ valid: false, error: "Invalid or expired" });
    }
  });

  fastify.post(
    "/api/superadmin/impersonate/:sessionId/force-end",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const params = sessionParamsSchema.parse(request.params);
      const actor = requireActor(request);
      const session = await fastify.prisma.impersonationSession.findUnique({
        where: {
          id: params.sessionId,
        },
        include: {
          tenant: true,
          superAdmin: true,
        },
      });

      if (!session) {
        return reply.status(404).send({ error: "Impersonation session not found" });
      }

      await endSession(request, session.id, ImpersonationEndReason.FORCE_ENDED);
      await fastify.prisma.superAdminLog.create({
        data: {
          superAdminId: actor.id,
          action: "IMPERSONATE_FORCE_END",
          targetType: "TENANT",
          targetId: session.tenantId,
          notes: `Force-ended ${session.superAdmin.email} impersonating ${session.tenant.name}`,
          metadata: {
            sessionId: session.id,
            tenantSlug: session.tenant.slug,
            impersonatedBy: session.superAdmin.email,
          },
        },
      });

      return { status: "ok" };
    },
  );

  fastify.post(
    "/api/superadmin/impersonate/:tenantId",
    { preHandler: requireSuperAdmin },
    async (request, reply) => {
      const params = tenantParamsSchema.parse(request.params);
      const input = startImpersonationSchema.parse(request.body ?? {});
      const actor = requireActor(request);
      const tenant = await fastify.prisma.tenant.findUnique({
        where: {
          id: params.tenantId,
        },
      });

      if (!tenant) {
        return reply.status(404).send({ error: "Shop not found" });
      }

      if (tenant.status === "SUSPENDED") {
        return reply.status(403).send({ error: "Cannot impersonate a suspended shop", code: "TENANT_SUSPENDED" });
      }

      const accessLevel = actor.role === SuperAdminRole.SUPPORT ? ImpersonationAccessLevel.READ_ONLY : input.accessLevel;
      const reason = input.reason?.trim() || null;

      if (input.accessLevel === ImpersonationAccessLevel.WRITE && actor.role === SuperAdminRole.SUPPORT) {
        return reply.status(403).send({ error: "Support users can only start read-only impersonation" });
      }

      if (accessLevel === ImpersonationAccessLevel.WRITE && (!reason || reason.length < 10)) {
        return reply.status(400).send({ error: "A reason of at least 10 characters is required for write impersonation" });
      }

      const activeSessionCount = await fastify.prisma.impersonationSession.count({
        where: {
          endedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
      });

      if (activeSessionCount >= maxActiveImpersonationSessions) {
        return reply.status(429).send({ error: "Too many active impersonation sessions. End an existing session first." });
      }

      const secret = createImpersonationSecret();
      const expiresAt = new Date(Date.now() + impersonationTtlMs);
      const session = await fastify.prisma.impersonationSession.create({
        data: {
          superAdminId: actor.id,
          tenantId: tenant.id,
          accessLevel,
          reason,
          tokenHash: await hash(secret),
          expiresAt,
          ipAddress: requestIp(request) ?? null,
          userAgent: requestUserAgent(request) ?? null,
        },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
              vertical: true,
              status: true,
            },
          },
          superAdmin: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      await Promise.all([
        fastify.prisma.auditLog.create({
          data: {
            tenantId: tenant.id,
            userId: actor.email,
            action: "IMPERSONATION_START",
            entity: "TENANT",
            entityId: tenant.id,
            changes: {
              sessionId: session.id,
              accessLevel,
              reason,
              superAdminEmail: actor.email,
            },
            ip: requestIp(request) ?? null,
          },
        }),
        fastify.prisma.superAdminLog.create({
          data: {
            superAdminId: actor.id,
            action: "IMPERSONATE_START",
            targetType: "TENANT",
            targetId: tenant.id,
            notes: `${actor.email} started ${accessLevel} impersonation for ${tenant.name}`,
            metadata: {
              sessionId: session.id,
              tenantSlug: tenant.slug,
              accessLevel,
              reason,
            },
          },
        }),
      ]);

      const token = `${session.id}.${secret}`;
      return reply.status(201).send({
        session: formatSession(session),
        token,
        sessionId: session.id,
        shopUrl: `/impersonate?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(session.id)}`,
      });
    },
  );

  done();

  async function endSession(request: FastifyRequest, sessionId: string, endReason: ImpersonationEndReason): Promise<void> {
    const session = await fastify.prisma.impersonationSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        tenant: true,
        superAdmin: true,
      },
    });

    if (!session) {
      return;
    }

    await fastify.prisma.impersonationSession.updateMany({
      where: {
        id: sessionId,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
        endReason,
        tokenHash: null,
      },
    });

    if (endReason !== ImpersonationEndReason.FORCE_ENDED) {
      await Promise.all([
        fastify.prisma.auditLog.create({
          data: {
            tenantId: session.tenantId,
            userId: session.superAdmin.email,
            action: "IMPERSONATION_END",
            entity: "TENANT",
            entityId: session.tenantId,
            changes: {
              sessionId: session.id,
              accessLevel: session.accessLevel,
              endReason,
              superAdminEmail: session.superAdmin.email,
            },
            ip: requestIp(request) ?? null,
          },
        }),
        fastify.prisma.superAdminLog.create({
          data: {
            superAdminId: session.superAdminId,
            action: "IMPERSONATE_END",
            targetType: "TENANT",
            targetId: session.tenantId,
            notes: `${session.superAdmin.email} ended impersonation for ${session.tenant.name}`,
            metadata: {
              sessionId: session.id,
              tenantSlug: session.tenant.slug,
              endReason,
            },
          },
        }),
      ]);
    }
  }
};

function requireActor(request: FastifyRequest) {
  if (!request.superAdmin) {
    throw new Error("Super-admin request was not authenticated");
  }

  return request.superAdmin;
}

function formatSession(session: {
  id: string;
  accessLevel: ImpersonationAccessLevel;
  reason: string | null;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: ImpersonationEndReason | null;
  actionsCount: number;
  createdAt: Date;
  tenant: {
    id: string;
    name: string;
    slug: string;
    vertical: string;
    status: string;
  };
  superAdmin: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}) {
  return {
    id: session.id,
    accessLevel: session.accessLevel,
    reason: session.reason,
    expiresAt: session.expiresAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    actionsCount: session.actionsCount,
    createdAt: session.createdAt,
    tenant: session.tenant,
    superAdmin: session.superAdmin,
    isActive: !session.endedAt && session.expiresAt > new Date(),
  };
}
