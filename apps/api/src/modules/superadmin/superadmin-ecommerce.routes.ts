import {
  BillingCycle,
  ModuleSubscriptionStatus,
  PlatformModule,
  Prisma,
  StorefrontApprovalStatus,
  StorefrontDomainStatus,
  StorefrontDomainType,
  StorefrontPaymentProvider,
  StorefrontStatus,
  StorefrontTheme,
  SuperAdminRole,
} from "@prisma/client";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { z } from "zod";

import { encryptStorefrontSecret } from "../storefront/storefront.credentials.js";
import { requireRole, requireSuperAdmin } from "./superadmin-auth.routes.js";

const ecommerceRootDomain = process.env.STOREFRONT_ROOT_DOMAIN ?? "bizbil.com";

const moduleParamsSchema = z.object({
  module: z.nativeEnum(PlatformModule),
});

const tenantParamsSchema = z.object({
  tenantId: z.string().min(1),
});

const approvalParamsSchema = z.object({
  id: z.string().min(1),
});

const modulePricingUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  basePrice: z.coerce.number().nonnegative().max(10000000).optional(),
  currency: z.string().trim().min(3).max(3).toUpperCase().optional(),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  isActive: z.coerce.boolean().optional(),
});

const ecommerceShopUpdateSchema = z.object({
  status: z.nativeEnum(StorefrontStatus).optional(),
  subscriptionStatus: z.nativeEnum(ModuleSubscriptionStatus).optional(),
  priceOverride: z.coerce.number().nonnegative().max(10000000).nullable().optional(),
  billingCycle: z.nativeEnum(BillingCycle).optional(),
  theme: z.nativeEnum(StorefrontTheme).optional(),
  subdomain: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  displayName: z.string().trim().min(2).max(120).nullable().optional(),
  heroTitle: z.string().trim().min(2).max(120).nullable().optional(),
  heroSubtitle: z.string().trim().min(2).max(240).nullable().optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  accentColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  allowGuestCheckout: z.coerce.boolean().optional(),
  allowCustomerLogin: z.coerce.boolean().optional(),
  allowCod: z.coerce.boolean().optional(),
  paymentProvider: z.nativeEnum(StorefrontPaymentProvider).nullable().optional(),
  tenantRazorpayKeyId: z.string().trim().min(4).max(120).nullable().optional(),
  tenantRazorpayKeySecret: z.string().trim().min(8).max(240).optional(),
  deliveryCharge: z.coerce.number().nonnegative().max(100000).optional(),
  freeDeliveryAbove: z.coerce.number().nonnegative().max(10000000).optional(),
  customDomain: z
    .string()
    .trim()
    .min(4)
    .max(255)
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/)
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

const rejectApprovalSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});

export const superAdminEcommerceRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/superadmin/ecommerce", { preHandler: requireSuperAdmin }, async () => {
    const [modulePricing, shops, approvals, metrics] = await Promise.all([
      fastify.prisma.modulePricing.findMany({
        orderBy: {
          module: "asc",
        },
      }),
      fastify.prisma.tenant.findMany({
        orderBy: {
          createdAt: "desc",
        },
        include: {
          storefrontSettings: true,
          storefrontDomains: {
            orderBy: [
              { type: "asc" },
              { createdAt: "desc" },
            ],
          },
          moduleSubscriptions: {
            where: {
              module: PlatformModule.ECOMMERCE,
            },
          },
          storefrontApprovals: {
            where: {
              status: StorefrontApprovalStatus.REQUESTED,
            },
            orderBy: {
              requestedAt: "desc",
            },
            take: 5,
          },
        },
        take: 250,
      }),
      fastify.prisma.storefrontApprovalRequest.findMany({
        where: {
          status: StorefrontApprovalStatus.REQUESTED,
        },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
            },
          },
        },
        orderBy: {
          requestedAt: "asc",
        },
        take: 100,
      }),
      storefrontMetrics(fastify),
    ]);

    return {
      modulePricing: modulePricing.map(formatModulePricing),
      shops: shops.map(formatEcommerceShop),
      approvals,
      metrics,
      rootDomain: ecommerceRootDomain,
    };
  });

  fastify.put(
    "/api/superadmin/ecommerce/pricing/:module",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request) => {
      const params = moduleParamsSchema.parse(request.params);
      const input = modulePricingUpdateSchema.parse(request.body);
      const actor = getSuperAdmin(request);

      const pricing = await fastify.prisma.modulePricing.upsert({
        where: {
          module: params.module,
        },
        create: {
          module: params.module,
          displayName: input.displayName ?? formatModuleLabel(params.module),
          description: input.description ?? null,
          basePrice: input.basePrice ?? 0,
          currency: input.currency ?? "INR",
          billingCycle: input.billingCycle ?? BillingCycle.MONTHLY,
          isActive: input.isActive ?? true,
        },
        update: cleanData({
          displayName: input.displayName,
          description: input.description,
          basePrice: input.basePrice,
          currency: input.currency,
          billingCycle: input.billingCycle,
          isActive: input.isActive,
        }),
      });

      await fastify.prisma.superAdminLog.create({
        data: {
          superAdminId: actor.id,
          action: "UPDATE_MODULE_PRICING",
          targetType: "MODULE_PRICING",
          targetId: params.module,
          notes: `${params.module} -> ${pricing.basePrice.toString()} ${pricing.currency}`,
        },
      });

      return { pricing: formatModulePricing(pricing) };
    },
  );

  fastify.put(
    "/api/superadmin/ecommerce/shops/:tenantId",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const params = tenantParamsSchema.parse(request.params);
      const input = ecommerceShopUpdateSchema.parse(request.body);
      const actor = getSuperAdmin(request);
      const tenant = await fastify.prisma.tenant.findUnique({
        where: {
          id: params.tenantId,
        },
      });

      if (!tenant) {
        return reply.status(404).send({ error: "Shop not found" });
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const settings = await tx.storefrontSettings.upsert({
          where: {
            tenantId: tenant.id,
          },
          create: {
            tenantId: tenant.id,
            status: input.status ?? StorefrontStatus.DISABLED,
            theme: input.theme ?? StorefrontTheme.CLASSIC_RETAIL,
            subdomain: input.subdomain ?? tenant.slug,
            displayName: input.displayName ?? tenant.name,
            heroTitle: input.heroTitle ?? tenant.name,
            heroSubtitle: input.heroSubtitle ?? "Order online from your local store",
            primaryColor: input.primaryColor ?? null,
            accentColor: input.accentColor ?? null,
            allowGuestCheckout: input.allowGuestCheckout ?? true,
            allowCustomerLogin: input.allowCustomerLogin ?? true,
            allowCod: input.allowCod ?? true,
            paymentProvider: input.paymentProvider ?? StorefrontPaymentProvider.PLATFORM_RAZORPAY,
            tenantRazorpayKeyId: input.tenantRazorpayKeyId ?? null,
            tenantRazorpayKeySecretCiphertext: input.tenantRazorpayKeySecret ? encryptStorefrontSecret(input.tenantRazorpayKeySecret) : null,
            deliveryCharge: input.deliveryCharge ?? 0,
            freeDeliveryAbove: input.freeDeliveryAbove ?? 0,
          },
          update: cleanData({
            status: input.status,
            theme: input.theme,
            subdomain: input.subdomain,
            displayName: input.displayName,
            heroTitle: input.heroTitle,
            heroSubtitle: input.heroSubtitle,
            primaryColor: input.primaryColor,
            accentColor: input.accentColor,
            allowGuestCheckout: input.allowGuestCheckout,
            allowCustomerLogin: input.allowCustomerLogin,
            allowCod: input.allowCod,
            paymentProvider: input.paymentProvider,
            tenantRazorpayKeyId: input.tenantRazorpayKeyId,
            tenantRazorpayKeySecretCiphertext: input.tenantRazorpayKeySecret ? encryptStorefrontSecret(input.tenantRazorpayKeySecret) : undefined,
            deliveryCharge: input.deliveryCharge,
            freeDeliveryAbove: input.freeDeliveryAbove,
          }),
        });

        const subscriptionStatus = input.subscriptionStatus ?? storefrontStatusToSubscriptionStatus(input.status);
        await tx.tenantModuleSubscription.upsert({
          where: {
            tenantId_module: {
              tenantId: tenant.id,
              module: PlatformModule.ECOMMERCE,
            },
          },
          create: {
            tenantId: tenant.id,
            module: PlatformModule.ECOMMERCE,
            status: subscriptionStatus,
            priceOverride: input.priceOverride ?? null,
            billingCycle: input.billingCycle ?? BillingCycle.MONTHLY,
            approvedAt: subscriptionStatus === ModuleSubscriptionStatus.ACTIVE ? new Date() : null,
            notes: input.notes ?? null,
          },
          update: cleanData({
            status: subscriptionStatus,
            priceOverride: input.priceOverride,
            billingCycle: input.billingCycle,
            approvedAt: subscriptionStatus === ModuleSubscriptionStatus.ACTIVE ? new Date() : undefined,
            notes: input.notes,
          }),
        });

        if ((input.status ?? settings.status) === StorefrontStatus.ACTIVE) {
          await tx.storefrontDomain.upsert({
            where: {
              hostname: defaultHostnameForSubdomain(settings.subdomain ?? tenant.slug),
            },
            create: {
              tenantId: tenant.id,
              storefrontId: settings.id,
              hostname: defaultHostnameForSubdomain(settings.subdomain ?? tenant.slug),
              type: StorefrontDomainType.DEFAULT_SUBDOMAIN,
              status: StorefrontDomainStatus.ACTIVE,
              approvedById: actor.id,
              approvedAt: new Date(),
            },
            update: {
              tenantId: tenant.id,
              storefrontId: settings.id,
              type: StorefrontDomainType.DEFAULT_SUBDOMAIN,
              status: StorefrontDomainStatus.ACTIVE,
              approvedById: actor.id,
              approvedAt: new Date(),
            },
          });
        }

        if (input.customDomain) {
          await tx.storefrontDomain.upsert({
            where: {
              hostname: input.customDomain,
            },
            create: {
              tenantId: tenant.id,
              storefrontId: settings.id,
              hostname: input.customDomain,
              type: StorefrontDomainType.CUSTOM,
              status: StorefrontDomainStatus.ACTIVE,
              approvedById: actor.id,
              approvedAt: new Date(),
              notes: input.notes ?? null,
            },
            update: {
              tenantId: tenant.id,
              storefrontId: settings.id,
              type: StorefrontDomainType.CUSTOM,
              status: StorefrontDomainStatus.ACTIVE,
              approvedById: actor.id,
              approvedAt: new Date(),
              notes: input.notes ?? null,
            },
          });
        }

        await tx.superAdminLog.create({
          data: {
            superAdminId: actor.id,
            action: "UPDATE_ECOMMERCE",
            targetType: "TENANT",
            targetId: tenant.id,
            notes: `${tenant.slug} ecommerce ${input.status ?? settings.status}`,
          },
        });

        return tx.tenant.findUniqueOrThrow({
          where: {
            id: tenant.id,
          },
          include: {
            storefrontSettings: true,
            storefrontDomains: true,
            moduleSubscriptions: {
              where: {
                module: PlatformModule.ECOMMERCE,
              },
            },
            storefrontApprovals: {
              where: {
                status: StorefrontApprovalStatus.REQUESTED,
              },
            },
          },
        });
      });

      return { shop: formatEcommerceShop(updated) };
    },
  );

  fastify.post(
    "/api/superadmin/ecommerce/approvals/:id/approve",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const params = approvalParamsSchema.parse(request.params);
      const actor = getSuperAdmin(request);
      const approval = await fastify.prisma.storefrontApprovalRequest.findUnique({
        where: {
          id: params.id,
        },
        include: {
          tenant: true,
        },
      });

      if (!approval) {
        return reply.status(404).send({ error: "Approval request not found" });
      }
      if (approval.status !== StorefrontApprovalStatus.REQUESTED) {
        return reply.status(409).send({ error: "Approval request is already resolved" });
      }

      const payload = asRecord(approval.payload);
      await fastify.prisma.$transaction(async (tx) => {
        const settings = await tx.storefrontSettings.upsert({
          where: {
            tenantId: approval.tenantId,
          },
          create: {
            tenantId: approval.tenantId,
            status: StorefrontStatus.DISABLED,
            theme: StorefrontTheme.CLASSIC_RETAIL,
            subdomain: approval.tenant.slug,
            displayName: approval.tenant.name,
          },
          update: {},
        });

        if (approval.type === "ENABLEMENT") {
          const subdomain = readString(payload, "subdomain") ?? settings.subdomain ?? approval.tenant.slug;
          const hostname = readString(payload, "hostname") ?? defaultHostnameForSubdomain(subdomain);
          await tx.storefrontSettings.update({
            where: {
              id: settings.id,
            },
            data: {
              status: StorefrontStatus.ACTIVE,
              subdomain,
            },
          });
          await tx.tenantModuleSubscription.upsert({
            where: {
              tenantId_module: {
                tenantId: approval.tenantId,
                module: PlatformModule.ECOMMERCE,
              },
            },
            create: {
              tenantId: approval.tenantId,
              module: PlatformModule.ECOMMERCE,
              status: ModuleSubscriptionStatus.ACTIVE,
              requestedAt: approval.requestedAt,
              approvedAt: new Date(),
            },
            update: {
              status: ModuleSubscriptionStatus.ACTIVE,
              approvedAt: new Date(),
            },
          });
          await tx.storefrontDomain.upsert({
            where: {
              hostname,
            },
            create: {
              tenantId: approval.tenantId,
              storefrontId: settings.id,
              hostname,
              type: StorefrontDomainType.DEFAULT_SUBDOMAIN,
              status: StorefrontDomainStatus.ACTIVE,
              approvedById: actor.id,
              approvedAt: new Date(),
            },
            update: {
              tenantId: approval.tenantId,
              storefrontId: settings.id,
              type: StorefrontDomainType.DEFAULT_SUBDOMAIN,
              status: StorefrontDomainStatus.ACTIVE,
              approvedById: actor.id,
              approvedAt: new Date(),
            },
          });
        } else if (approval.type === "DOMAIN") {
          const hostname = readString(payload, "hostname");
          if (hostname) {
            await tx.storefrontDomain.upsert({
              where: {
                hostname,
              },
              create: {
                tenantId: approval.tenantId,
                storefrontId: settings.id,
                hostname,
                type: StorefrontDomainType.CUSTOM,
                status: StorefrontDomainStatus.ACTIVE,
                approvedById: actor.id,
                approvedAt: new Date(),
              },
              update: {
                tenantId: approval.tenantId,
                storefrontId: settings.id,
                type: StorefrontDomainType.CUSTOM,
                status: StorefrontDomainStatus.ACTIVE,
                approvedById: actor.id,
                approvedAt: new Date(),
              },
            });
          }
        } else {
          await tx.storefrontSettings.update({
            where: {
              id: settings.id,
            },
            data: storefrontSettingsDataFromPayload(payload),
          });
        }

        await tx.storefrontApprovalRequest.update({
          where: {
            id: approval.id,
          },
          data: {
            status: StorefrontApprovalStatus.APPROVED,
            approvedById: actor.id,
            resolvedAt: new Date(),
          },
        });

        await tx.superAdminLog.create({
          data: {
            superAdminId: actor.id,
            action: "APPROVE_ECOMMERCE_REQUEST",
            targetType: "TENANT",
            targetId: approval.tenantId,
            notes: `${approval.type} approved for ${approval.tenant.slug}`,
            metadata: {
              approvalId: approval.id,
              type: approval.type,
            },
          },
        });
      });

      return { status: "ok" };
    },
  );

  fastify.post(
    "/api/superadmin/ecommerce/approvals/:id/reject",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const params = approvalParamsSchema.parse(request.params);
      const input = rejectApprovalSchema.parse(request.body);
      const actor = getSuperAdmin(request);
      const approval = await fastify.prisma.storefrontApprovalRequest.findUnique({
        where: {
          id: params.id,
        },
      });

      if (!approval) {
        return reply.status(404).send({ error: "Approval request not found" });
      }
      if (approval.status !== StorefrontApprovalStatus.REQUESTED) {
        return reply.status(409).send({ error: "Approval request is already resolved" });
      }

      const payload = asRecord(approval.payload);
      await fastify.prisma.$transaction(async (tx) => {
        await tx.storefrontApprovalRequest.update({
          where: {
            id: approval.id,
          },
          data: {
            status: StorefrontApprovalStatus.REJECTED,
            approvedById: actor.id,
            rejectionReason: input.reason,
            resolvedAt: new Date(),
          },
        });

        const hostname = readString(payload, "hostname");
        if (approval.type === "DOMAIN" && hostname) {
          await tx.storefrontDomain.updateMany({
            where: {
              tenantId: approval.tenantId,
              hostname,
            },
            data: {
              status: StorefrontDomainStatus.REJECTED,
              approvedById: actor.id,
              notes: input.reason,
            },
          });
        }

        await tx.superAdminLog.create({
          data: {
            superAdminId: actor.id,
            action: "REJECT_ECOMMERCE_REQUEST",
            targetType: "TENANT",
            targetId: approval.tenantId,
            notes: input.reason,
            metadata: {
              approvalId: approval.id,
              type: approval.type,
            },
          },
        });
      });

      return { status: "ok" };
    },
  );

  done();
};

async function storefrontMetrics(fastify: Parameters<FastifyPluginCallback>[0]) {
  const [active, requested, domains, approvals] = await Promise.all([
    fastify.prisma.storefrontSettings.count({
      where: {
        status: StorefrontStatus.ACTIVE,
      },
    }),
    fastify.prisma.storefrontSettings.count({
      where: {
        status: StorefrontStatus.REQUESTED,
      },
    }),
    fastify.prisma.storefrontDomain.count({
      where: {
        status: StorefrontDomainStatus.ACTIVE,
      },
    }),
    fastify.prisma.storefrontApprovalRequest.count({
      where: {
        status: StorefrontApprovalStatus.REQUESTED,
      },
    }),
  ]);

  return {
    active,
    requested,
    activeDomains: domains,
    pendingApprovals: approvals,
  };
}

function getSuperAdmin(request: FastifyRequest) {
  if (!request.superAdmin) {
    throw new Error("Super-admin request was not authenticated");
  }

  return request.superAdmin;
}

function storefrontStatusToSubscriptionStatus(status: StorefrontStatus | undefined): ModuleSubscriptionStatus {
  if (status === StorefrontStatus.ACTIVE) return ModuleSubscriptionStatus.ACTIVE;
  if (status === StorefrontStatus.REQUESTED) return ModuleSubscriptionStatus.REQUESTED;
  if (status === StorefrontStatus.SUSPENDED) return ModuleSubscriptionStatus.SUSPENDED;
  return ModuleSubscriptionStatus.DISABLED;
}

function defaultHostnameForSubdomain(subdomain: string): string {
  return `${subdomain}.${ecommerceRootDomain}`;
}

function cleanData<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Record<string, unknown>;
}

function storefrontSettingsDataFromPayload(payload: Record<string, unknown>) {
  return cleanData({
    theme: enumValue(StorefrontTheme, payload.theme),
    displayName: stringOrNull(payload.displayName),
    heroTitle: stringOrNull(payload.heroTitle),
    heroSubtitle: stringOrNull(payload.heroSubtitle),
    primaryColor: stringOrNull(payload.primaryColor),
    accentColor: stringOrNull(payload.accentColor),
    allowGuestCheckout: booleanOrUndefined(payload.allowGuestCheckout),
    allowCustomerLogin: booleanOrUndefined(payload.allowCustomerLogin),
    allowCod: booleanOrUndefined(payload.allowCod),
    paymentProvider: enumValue(StorefrontPaymentProvider, payload.paymentProvider),
    tenantRazorpayKeyId: stringOrNull(payload.tenantRazorpayKeyId),
    tenantRazorpayKeySecretCiphertext: stringOrUndefined(payload.tenantRazorpayKeySecretCiphertext),
    deliveryCharge: numberOrUndefined(payload.deliveryCharge),
    freeDeliveryAbove: numberOrUndefined(payload.freeDeliveryAbove),
  });
}

function enumValue<T extends Record<string, string>>(values: T, value: unknown): T[keyof T] | undefined {
  return typeof value === "string" && value in values ? values[value as keyof T] : undefined;
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatModulePricing(pricing: {
  module: PlatformModule;
  displayName: string;
  description: string | null;
  basePrice: Prisma.Decimal | { toString(): string };
  currency: string;
  billingCycle: BillingCycle;
  isActive: boolean;
  updatedAt: Date;
}) {
  return {
    ...pricing,
    basePrice: pricing.basePrice.toString(),
  };
}

function formatEcommerceShop(shop: {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  phone: string;
  status: string;
  storefrontSettings: {
    id: string;
    status: StorefrontStatus;
    theme: StorefrontTheme;
    subdomain: string | null;
    displayName: string | null;
    paymentProvider: StorefrontPaymentProvider | null;
    tenantRazorpayKeyId: string | null;
    tenantRazorpayKeySecretCiphertext: string | null;
    deliveryCharge: Prisma.Decimal | { toString(): string };
    freeDeliveryAbove: Prisma.Decimal | { toString(): string };
    allowGuestCheckout: boolean;
    allowCustomerLogin: boolean;
    allowCod: boolean;
    updatedAt: Date;
  } | null;
  storefrontDomains: Array<{
    id: string;
    hostname: string;
    type: StorefrontDomainType;
    status: StorefrontDomainStatus;
    approvedAt: Date | null;
  }>;
  moduleSubscriptions: Array<{
    status: ModuleSubscriptionStatus;
    priceOverride: Prisma.Decimal | { toString(): string } | null;
    billingCycle: BillingCycle;
  }>;
  storefrontApprovals: Array<{ id: string }>;
}) {
  const settings = shop.storefrontSettings;
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    vertical: shop.vertical,
    phone: shop.phone,
    status: shop.status,
    storefront: settings
      ? {
          id: settings.id,
          status: settings.status,
          theme: settings.theme,
          subdomain: settings.subdomain,
          defaultHostname: defaultHostnameForSubdomain(settings.subdomain ?? shop.slug),
          displayName: settings.displayName,
          paymentProvider: settings.paymentProvider,
          tenantRazorpayKeyId: settings.tenantRazorpayKeyId,
          hasTenantRazorpaySecret: Boolean(settings.tenantRazorpayKeySecretCiphertext),
          deliveryCharge: settings.deliveryCharge.toString(),
          freeDeliveryAbove: settings.freeDeliveryAbove.toString(),
          allowGuestCheckout: settings.allowGuestCheckout,
          allowCustomerLogin: settings.allowCustomerLogin,
          allowCod: settings.allowCod,
          updatedAt: settings.updatedAt,
        }
      : null,
    domains: shop.storefrontDomains,
    subscription: shop.moduleSubscriptions[0]
      ? {
          ...shop.moduleSubscriptions[0],
          priceOverride: shop.moduleSubscriptions[0].priceOverride?.toString() ?? null,
        }
      : null,
    pendingApprovalCount: shop.storefrontApprovals.length,
  };
}

function formatModuleLabel(module: PlatformModule): string {
  return module
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
