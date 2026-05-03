import { createHash, randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { SuperAdminRole } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { getCookieValue } from "../../plugins/auth.js";

const superAdminCookieName = "sa_token";
const sessionTtlMs = 8 * 60 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

const createAdminSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(SuperAdminRole).default(SuperAdminRole.SUPPORT),
});

const adminIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const superAdminAuthRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.post("/api/superadmin/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const superAdmin = await fastify.prisma.superAdmin.findUnique({
      where: {
        email: input.email,
      },
    });

    if (!superAdmin?.isActive || !(await verify(superAdmin.passwordHash, input.password))) {
      return reply.status(401).send({ error: "Invalid super-admin credentials" });
    }

    const token = await createSession(fastify, superAdmin.id);
    setSuperAdminCookie(reply, token, sessionTtlMs / 1000);

    return {
      admin: {
        id: superAdmin.id,
        name: superAdmin.name,
        email: superAdmin.email,
        role: superAdmin.role,
      },
    };
  });

  fastify.post("/api/superadmin/auth/logout", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const actor = getSuperAdmin(request);
    await fastify.prisma.superAdminSession.updateMany({
      where: {
        id: actor.sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    clearSuperAdminCookie(reply);
    return { status: "ok" };
  });

  fastify.get("/api/superadmin/auth/me", { preHandler: requireSuperAdmin }, (request) => {
    return {
      admin: request.superAdmin,
    };
  });

  fastify.get("/api/superadmin/admins", { preHandler: requireSuperAdmin }, async () => {
    const admins = await fastify.prisma.superAdmin.findMany({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return { admins };
  });

  fastify.post(
    "/api/superadmin/admins",
    { preHandler: requireRole([SuperAdminRole.OWNER]) },
    async (request, reply) => {
      const input = createAdminSchema.parse(request.body);
      const actor = getSuperAdmin(request);

      const admin = await fastify.prisma.superAdmin.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash: await hash(input.password),
          role: input.role,
          createdById: actor.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      await fastify.prisma.superAdminLog.create({
        data: {
          superAdminId: actor.id,
          action: "CREATE_SUPER_ADMIN",
          targetType: "SUPER_ADMIN",
          targetId: admin.id,
          notes: `Created ${admin.email} as ${admin.role}`,
        },
      });

      return reply.status(201).send({ admin });
    },
  );

  fastify.patch(
    "/api/superadmin/admins/:id/deactivate",
    { preHandler: requireRole([SuperAdminRole.OWNER]) },
    async (request) => {
      const params = adminIdParamsSchema.parse(request.params);
      const actor = getSuperAdmin(request);

      const admin = await fastify.prisma.superAdmin.update({
        where: {
          id: params.id,
        },
        data: {
          isActive: false,
          sessions: {
            updateMany: {
              where: {
                revokedAt: null,
              },
              data: {
                revokedAt: new Date(),
              },
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      await fastify.prisma.superAdminLog.create({
        data: {
          superAdminId: actor.id,
          action: "DEACTIVATE_SUPER_ADMIN",
          targetType: "SUPER_ADMIN",
          targetId: admin.id,
          notes: `Deactivated ${admin.email}`,
        },
      });

      return { admin };
    },
  );
  done();
};

export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = getCookieValue(request.headers.cookie, superAdminCookieName);

  if (!token) {
    await reply.status(401).send({ error: "Super-admin login required" });
    return;
  }

  const [sessionId, secret] = token.split(".");
  if (!sessionId || !secret) {
    await reply.status(401).send({ error: "Invalid super-admin session" });
    return;
  }

  const session = await request.server.prisma.superAdminSession.findFirst({
    where: {
      id: sessionId,
      tokenHash: hashToken(secret),
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    include: {
      superAdmin: true,
    },
  });

  if (!session?.superAdmin.isActive) {
    await reply.status(401).send({ error: "Super-admin session expired" });
    return;
  }

  request.superAdmin = {
    id: session.superAdmin.id,
    name: session.superAdmin.name,
    email: session.superAdmin.email,
    role: session.superAdmin.role,
    sessionId: session.id,
  };
}

export function requireRole(roles: SuperAdminRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireSuperAdmin(request, reply);

    if (reply.sent) {
      return;
    }

    if (!request.superAdmin || !roles.includes(request.superAdmin.role)) {
      await reply.status(403).send({ error: "Insufficient super-admin permissions" });
    }
  };
}

function getSuperAdmin(request: FastifyRequest) {
  if (!request.superAdmin) {
    throw new Error("Super-admin request was not authenticated");
  }

  return request.superAdmin;
}

async function createSession(fastify: FastifyInstance, superAdminId: string): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  const session = await fastify.prisma.superAdminSession.create({
    data: {
      superAdminId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + sessionTtlMs),
    },
  });

  return `${session.id}.${secret}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSuperAdminCookie(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
  reply.header(
    "Set-Cookie",
    serializeCookie(superAdminCookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/api/superadmin",
      maxAge: maxAgeSeconds,
    }),
  );
}

function clearSuperAdminCookie(reply: FastifyReply): void {
  reply.header(
    "Set-Cookie",
    serializeCookie(superAdminCookieName, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/api/superadmin",
      maxAge: 0,
    }),
  );
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
    path: string;
    maxAge: number;
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${String(options.maxAge)}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}
