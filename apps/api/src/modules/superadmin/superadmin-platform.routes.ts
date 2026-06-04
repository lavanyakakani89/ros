import { BillingCycle, ModuleSubscriptionStatus, PlatformModule, SuperAdminRole, type Prisma } from "@prisma/client";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireRole, requireSuperAdmin } from "./superadmin-auth.routes.js";

const moduleParamsSchema = z.object({
  module: z.nativeEnum(PlatformModule),
});

const tenantModuleParamsSchema = moduleParamsSchema.extend({
  tenantId: z.string().min(1),
});

const auditQuerySchema = z.object({
  targetType: z.string().trim().optional(),
  targetId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

const moduleSubscriptionUpdateSchema = z.object({
  status: z.nativeEnum(ModuleSubscriptionStatus),
  priceOverride: z.coerce.number().nonnegative().max(10000000).nullable().optional(),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const superAdminPlatformRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/superadmin/platform", { preHandler: requireSuperAdmin }, async () => {
    const [modulePricing, moduleCounts, recentLogs] = await Promise.all([
      fastify.prisma.modulePricing.findMany({ orderBy: { module: "asc" } }),
      Promise.all(Object.values(PlatformModule).map(async (module) => ({
        module,
        active: await fastify.prisma.tenantModuleSubscription.count({ where: { module, status: ModuleSubscriptionStatus.ACTIVE } }),
        requested: await fastify.prisma.tenantModuleSubscription.count({ where: { module, status: ModuleSubscriptionStatus.REQUESTED } }),
        suspended: await fastify.prisma.tenantModuleSubscription.count({ where: { module, status: ModuleSubscriptionStatus.SUSPENDED } }),
      }))),
      fastify.prisma.superAdminLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          superAdmin: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      modules: Object.values(PlatformModule).map((module) => {
        const pricing = modulePricing.find((item) => item.module === module);
        const counts = moduleCounts.find((item) => item.module === module);
        return {
          module,
          displayName: pricing?.displayName ?? formatModuleLabel(module),
          description: pricing?.description ?? null,
          basePrice: pricing?.basePrice.toString() ?? "0",
          currency: pricing?.currency ?? "INR",
          billingCycle: pricing?.billingCycle ?? BillingCycle.MONTHLY,
          isActive: pricing?.isActive ?? true,
          counts: {
            active: counts?.active ?? 0,
            requested: counts?.requested ?? 0,
            suspended: counts?.suspended ?? 0,
          },
        };
      }),
      config: platformConfigStatus(),
      recentLogs: recentLogs.map(formatLog),
    };
  });

  fastify.get("/api/superadmin/audit/logs", { preHandler: requireSuperAdmin }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const logs = await fastify.prisma.superAdminLog.findMany({
      where: {
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      include: {
        superAdmin: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    return { logs: logs.map(formatLog) };
  });

  fastify.put(
    "/api/superadmin/shops/:tenantId/modules/:module",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request) => {
      const params = tenantModuleParamsSchema.parse(request.params);
      const input = moduleSubscriptionUpdateSchema.parse(request.body);
      const actor = getSuperAdmin(request);
      const updateData: Prisma.TenantModuleSubscriptionUpdateInput = {
        status: input.status,
        priceOverride: input.priceOverride ?? null,
        startsAt: input.startsAt ?? null,
        expiresAt: input.expiresAt ?? null,
        notes: input.notes ?? null,
      };

      if (input.billingCycle) {
        updateData.billingCycle = input.billingCycle;
      }

      if (input.status === ModuleSubscriptionStatus.ACTIVE) {
        updateData.approvedAt = new Date();
      }

      const subscription = await fastify.prisma.tenantModuleSubscription.upsert({
        where: {
          tenantId_module: {
            tenantId: params.tenantId,
            module: params.module,
          },
        },
        create: {
          tenantId: params.tenantId,
          module: params.module,
          status: input.status,
          priceOverride: input.priceOverride ?? null,
          billingCycle: input.billingCycle ?? BillingCycle.MONTHLY,
          startsAt: input.startsAt ?? null,
          expiresAt: input.expiresAt ?? null,
          requestedAt: input.status === ModuleSubscriptionStatus.REQUESTED ? new Date() : null,
          approvedAt: input.status === ModuleSubscriptionStatus.ACTIVE ? new Date() : null,
          notes: input.notes ?? null,
        },
        update: updateData,
      });

      await fastify.prisma.superAdminLog.create({
        data: {
          superAdminId: actor.id,
          action: "UPDATE_MODULE_SUBSCRIPTION",
          targetType: "TENANT",
          targetId: params.tenantId,
          notes: `${params.module} -> ${subscription.status}`,
          metadata: {
            module: params.module,
            subscriptionId: subscription.id,
          },
        },
      });

      return { subscription: formatSubscription(subscription) };
    },
  );

  done();
};

function platformConfigStatus() {
  return {
    googleImageSearch: {
      configured: Boolean(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY?.trim() && process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID?.trim()),
      required: ["GOOGLE_CUSTOM_SEARCH_API_KEY", "GOOGLE_CUSTOM_SEARCH_ENGINE_ID"],
    },
    platformRazorpay: {
      configured: Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim()),
      required: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
    },
    storefrontRootDomain: {
      configured: Boolean((process.env.STOREFRONT_ROOT_DOMAIN ?? "bizbil.com").trim()),
      value: process.env.STOREFRONT_ROOT_DOMAIN ?? "bizbil.com",
    },
    whatsapp: {
      configured: Boolean(process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim()),
      required: ["WHATSAPP_TOKEN_ENCRYPTION_KEY"],
    },
  };
}

function formatSubscription(subscription: {
  module: PlatformModule;
  status: ModuleSubscriptionStatus;
  priceOverride: Prisma.Decimal | { toString(): string } | null;
  currency: string;
  billingCycle: BillingCycle;
  startsAt: Date | null;
  expiresAt: Date | null;
  requestedAt: Date | null;
  approvedAt: Date | null;
  notes: string | null;
}) {
  return {
    ...subscription,
    priceOverride: subscription.priceOverride?.toString() ?? null,
  };
}

function formatLog(log: {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  notes: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  superAdmin: {
    name: string;
    email: string;
  };
}) {
  return {
    id: log.id,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    notes: log.notes,
    metadata: log.metadata,
    createdAt: log.createdAt,
    superAdmin: log.superAdmin,
  };
}

function getSuperAdmin(request: FastifyRequest) {
  if (!request.superAdmin) {
    throw new Error("Super-admin request was not authenticated");
  }

  return request.superAdmin;
}

function formatModuleLabel(module: PlatformModule): string {
  return module
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
