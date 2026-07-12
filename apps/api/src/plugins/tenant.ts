import type { Tenant } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { verifyRequestJwt } from "./auth.js";
import {
  ImpersonationAuthError,
  resolveImpersonationFromHeader,
  toRequestImpersonationContext,
} from "./impersonation.js";
import { enforceRbac } from "./rbac.js";

const tenantCacheTtlSeconds = 300;
const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const publicRoutePrefixes = [
  "/health",
  "/api/health",
  "/api/version",
  "/metrics",
  "/api/auth/",
  "/api/superadmin/",
  "/api/payments/razorpay/webhook",
  "/api/whatsapp/webhook",
  "/api/public/payment-integrations/phonepe/",
  "/api/public/storefront/",
  "/api/public/whatsapp/",
];
const impersonationRestrictedWritePrefixes = ["/api/settings/password", "/api/settings/users", "/api/settings/tenant"];

const tenantPluginCallback: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.addHook("preHandler", async (request, reply) => {
    if (isPublicRoute(request.url)) {
      return;
    }

    const impersonation = await resolveImpersonation(request, reply);
    if (reply.sent) {
      return;
    }

    if (impersonation) {
      request.tenant = impersonation.tenant;
      request.storeId = null;
      request.isImpersonated = true;
      request.impersonation = toRequestImpersonationContext(impersonation);
      await setTenantContext(impersonation.tenant.id);

      if (isWriteRequest(request.method) && isRestrictedImpersonationWrite(request.url)) {
        return reply.status(403).send({
          error: "This action is not permitted during support impersonation",
          code: "IMPERSONATION_RESTRICTED_ACTION",
        });
      }

      if (isWriteRequest(request.method) && impersonation.accessLevel === "READ_ONLY") {
        return reply.status(403).send({
          error: "Write actions are not permitted in read-only support mode",
          code: "IMPERSONATION_READ_ONLY",
        });
      }

      return;
    }

    try {
      verifyRequestJwt(fastify, request);
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const user = request.user as { tenantId?: string; storeId?: string | null } | undefined;
    const tenantId = user?.tenantId;

    if (!tenantId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const cacheKey = `tenant:${tenantId}`;
    const cachedTenant = await fastify.redis.get(cacheKey);
    let tenant: Tenant | null = cachedTenant ? (JSON.parse(cachedTenant) as Tenant) : null;

    if (!tenant) {
      tenant = await fastify.prisma.tenant.findUnique({
        where: {
          id: tenantId,
        },
      });

      if (!tenant) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      await fastify.redis.set(cacheKey, JSON.stringify(tenant), "EX", tenantCacheTtlSeconds);
    }

    if (tenant.status === "SUSPENDED") {
      return reply.status(403).send({
        error: "Account suspended",
        code: "TENANT_SUSPENDED",
        message: "This shop is suspended. Contact your BizBil administrator to reactivate access.",
      });
    }

    request.tenant = tenant;
    request.storeId = typeof user.storeId === "string" ? user.storeId : null;
    await setTenantContext(tenantId);
    return enforceRbac(request, reply);
  });

  fastify.addHook("onResponse", async (request, reply) => {
    if (!request.isImpersonated || !request.impersonation || !isWriteRequest(request.method)) {
      return;
    }

    if (reply.statusCode < 200 || reply.statusCode >= 300) {
      return;
    }

    const context = request.impersonation;
    const metadata = {
      sessionId: context.sessionId,
      accessLevel: context.accessLevel,
      method: request.method,
      url: request.url,
      superAdminEmail: context.superAdminEmail,
    };
    const path = request.url.split("?")[0] || request.url;

    try {
      await Promise.all([
        fastify.prisma.auditLog.create({
          data: {
            tenantId: request.tenant.id,
            userId: context.superAdminEmail,
            action: "IMPERSONATION_WRITE",
            entity: path,
            entityId: context.sessionId,
            changes: metadata,
            ip: request.ip,
          },
        }),
        fastify.prisma.superAdminLog.create({
          data: {
            superAdminId: context.superAdminId,
            action: "IMPERSONATE_WRITE_ACTION",
            targetType: "TENANT",
            targetId: request.tenant.id,
            notes: `${request.method} ${request.url}`,
            metadata,
          },
        }),
        fastify.prisma.impersonationSession.updateMany({
          where: {
            id: context.sessionId,
            endedAt: null,
          },
          data: {
            actionsCount: {
              increment: 1,
            },
          },
        }),
      ]);
    } catch (error) {
      fastify.log.error({ error, sessionId: context.sessionId }, "Failed to write impersonation audit logs");
    }
  });

  done();

  async function resolveImpersonation(request: FastifyRequest, reply: FastifyReply) {
    try {
      return await resolveImpersonationFromHeader(fastify, request);
    } catch (error) {
      if (error instanceof ImpersonationAuthError) {
        await reply.status(error.statusCode).send({
          error: error.message,
          code: error.code,
        });
        return null;
      }

      throw error;
    }
  }

  async function setTenantContext(tenantId: string): Promise<void> {
    await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, FALSE)`;
  }
};

export const tenantPlugin = fp(tenantPluginCallback);

function isPublicRoute(url: string): boolean {
  return publicRoutePrefixes.some((prefix) => url === prefix || url.startsWith(prefix));
}

function isWriteRequest(method: string): boolean {
  return writeMethods.has(method.toUpperCase());
}

function isRestrictedImpersonationWrite(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return impersonationRestrictedWritePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
