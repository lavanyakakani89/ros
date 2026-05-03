import { hash } from "@node-rs/argon2";
import { BillingCycle, LicensePlan, SuperAdminRole, TenantStatus, UserRole, VerticalType } from "@prisma/client";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireRole, requireSuperAdmin } from "./superadmin-auth.routes.js";

const shopQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.nativeEnum(TenantStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

const createShopSchema = z.object({
  tenantName: z.string().trim().min(2),
  tenantSlug: z
    .string()
    .trim()
    .min(3)
    .max(48)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  vertical: z.nativeEnum(VerticalType),
  phone: z.string().trim().min(10).max(16),
  gstNumber: z.string().trim().min(15).max(15).optional(),
  address: z.string().trim().min(3).optional(),
  ownerName: z.string().trim().min(2),
  ownerEmail: z.string().trim().email().toLowerCase(),
  ownerPhone: z.string().trim().min(10).max(16).optional(),
  ownerPassword: z.string().min(8).max(128),
  plan: z.nativeEnum(LicensePlan).default(LicensePlan.STARTER),
  billingCycle: z.nativeEnum(BillingCycle).default(BillingCycle.YEARLY),
  startDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  amountPaid: z.coerce.number().nonnegative().default(0),
  paymentRef: z.string().trim().optional(),
  paymentMode: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const tenantIdParamsSchema = z.object({
  id: z.string().min(1),
});

const updateLicenseSchema = z.object({
  plan: z.nativeEnum(LicensePlan),
  billingCycle: z.nativeEnum(BillingCycle),
  startDate: z.coerce.date(),
  expiryDate: z.coerce.date(),
  amountPaid: z.coerce.number().nonnegative(),
  paymentRef: z.string().trim().optional(),
  paymentMode: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const tenantStatusRoutes = [
  { path: "/api/superadmin/shops/:id/suspend", status: TenantStatus.SUSPENDED, action: "SUSPEND_TENANT" },
  { path: "/api/superadmin/shops/:id/reactivate", status: TenantStatus.ACTIVE, action: "REACTIVATE_TENANT" },
  { path: "/api/superadmin/shops/:id/warning", status: TenantStatus.WARNING, action: "MARK_TENANT_WARNING" },
] as const;

export const superAdminShopsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/superadmin/dashboard", { preHandler: requireSuperAdmin }, async () => {
    const now = new Date();
    const expiryWindow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [totalShops, activeShops, warningShops, suspendedShops, expiringLicenses, revenue] = await Promise.all([
      fastify.prisma.tenant.count(),
      fastify.prisma.tenant.count({ where: { status: TenantStatus.ACTIVE } }),
      fastify.prisma.tenant.count({ where: { status: TenantStatus.WARNING } }),
      fastify.prisma.tenant.count({ where: { status: TenantStatus.SUSPENDED } }),
      fastify.prisma.tenantLicense.count({
        where: {
          expiryDate: {
            gte: now,
            lte: expiryWindow,
          },
        },
      }),
      fastify.prisma.tenantLicense.aggregate({
        _sum: {
          amountPaid: true,
        },
      }),
    ]);

    return {
      metrics: {
        totalShops,
        activeShops,
        warningShops,
        suspendedShops,
        expiringLicenses,
        revenue: revenue._sum.amountPaid?.toString() ?? "0",
      },
    };
  });

  fastify.get("/api/superadmin/shops", { preHandler: requireSuperAdmin }, async (request) => {
    const query = shopQuerySchema.parse(request.query);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { slug: { contains: query.search, mode: "insensitive" as const } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [shops, total] = await Promise.all([
      fastify.prisma.tenant.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          license: true,
          _count: {
            select: {
              users: true,
              products: true,
              invoices: true,
            },
          },
        },
      }),
      fastify.prisma.tenant.count({ where }),
    ]);

    return {
      shops: shops.map(formatTenant),
      page: query.page,
      limit: query.limit,
      total,
    };
  });

  fastify.get("/api/superadmin/shops/:id", { preHandler: requireSuperAdmin }, async (request, reply) => {
    const params = tenantIdParamsSchema.parse(request.params);
    const shop = await fastify.prisma.tenant.findUnique({
      where: {
        id: params.id,
      },
      include: {
        license: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            products: true,
            customers: true,
            invoices: true,
            deliveries: true,
          },
        },
      },
    });

    if (!shop) {
      return reply.status(404).send({ error: "Shop not found" });
    }

    return { shop: formatTenant(shop) };
  });

  fastify.post(
    "/api/superadmin/shops",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const input = createShopSchema.parse(request.body);
      const actor = getSuperAdmin(request);
      const startDate = input.startDate ?? new Date();
      const expiryDate = input.expiryDate ?? addMonths(startDate, defaultCycleMonths(input.billingCycle));
      const existingTenant = await fastify.prisma.tenant.findUnique({
        where: {
          slug: input.tenantSlug,
        },
        select: {
          id: true,
        },
      });

      if (existingTenant) {
        return reply.status(409).send({ error: "Shop slug already exists. Use a different slug." });
      }

      const shop = await fastify.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: input.tenantName,
            slug: input.tenantSlug,
            vertical: input.vertical,
            phone: input.phone,
            gstNumber: input.gstNumber ?? null,
            address: input.address ?? null,
            status: TenantStatus.ACTIVE,
          },
        });

        await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: input.ownerName,
            email: input.ownerEmail,
            phone: input.ownerPhone ?? input.phone,
            passwordHash: await hash(input.ownerPassword),
            role: UserRole.OWNER,
          },
        });

        await tx.tenantLicense.create({
          data: {
            tenantId: tenant.id,
            plan: input.plan,
            billingCycle: input.billingCycle,
            startDate,
            expiryDate,
            amountPaid: input.amountPaid,
            paymentRef: input.paymentRef ?? null,
            paymentMode: input.paymentMode ?? null,
            notes: input.notes ?? null,
            createdById: actor.id,
            lastModifiedById: actor.id,
          },
        });

        await tx.superAdminLog.create({
          data: {
            superAdminId: actor.id,
            action: "CREATE_SHOP",
            targetType: "TENANT",
            targetId: tenant.id,
            notes: `Created ${tenant.slug}`,
          },
        });

        return tx.tenant.findUniqueOrThrow({
          where: {
            id: tenant.id,
          },
          include: {
            license: true,
            _count: {
              select: {
                users: true,
                products: true,
                invoices: true,
              },
            },
          },
        });
      });

      return reply.status(201).send({ shop: formatTenant(shop) });
    },
  );

  for (const route of tenantStatusRoutes) {
    fastify.patch(
      route.path,
      { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
      async (request) => {
        const params = tenantIdParamsSchema.parse(request.params);
        const actor = getSuperAdmin(request);
        const tenant = await fastify.prisma.tenant.update({
          where: {
            id: params.id,
          },
          data: {
            status: route.status,
          },
        });

        await Promise.all([
          fastify.redis.del(`tenant:${tenant.id}`),
          fastify.prisma.superAdminLog.create({
            data: {
              superAdminId: actor.id,
              action: route.action,
              targetType: "TENANT",
              targetId: tenant.id,
              notes: `${tenant.slug} -> ${route.status}`,
            },
          }),
        ]);

        return { shop: formatTenant({ ...tenant, license: null }) };
      },
    );
  }

  fastify.put(
    "/api/superadmin/shops/:id/license",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request) => {
      const params = tenantIdParamsSchema.parse(request.params);
      const input = updateLicenseSchema.parse(request.body);
      const actor = getSuperAdmin(request);
      const license = await fastify.prisma.tenantLicense.upsert({
        where: {
          tenantId: params.id,
        },
        create: {
          tenantId: params.id,
          plan: input.plan,
          billingCycle: input.billingCycle,
          startDate: input.startDate,
          expiryDate: input.expiryDate,
          amountPaid: input.amountPaid,
          paymentRef: input.paymentRef ?? null,
          paymentMode: input.paymentMode ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
          lastModifiedById: actor.id,
        },
        update: {
          plan: input.plan,
          billingCycle: input.billingCycle,
          startDate: input.startDate,
          expiryDate: input.expiryDate,
          amountPaid: input.amountPaid,
          paymentRef: input.paymentRef ?? null,
          paymentMode: input.paymentMode ?? null,
          notes: input.notes ?? null,
          lastModifiedById: actor.id,
        },
      });

      await fastify.prisma.superAdminLog.create({
        data: {
          superAdminId: actor.id,
          action: "UPDATE_LICENSE",
          targetType: "TENANT",
          targetId: params.id,
          notes: `${license.plan} until ${license.expiryDate.toISOString().slice(0, 10)}`,
        },
      });

      return { license: formatLicense(license) };
    },
  );

  fastify.get("/api/superadmin/shops/:id/logs", { preHandler: requireSuperAdmin }, async (request) => {
    const params = tenantIdParamsSchema.parse(request.params);
    const logs = await fastify.prisma.superAdminLog.findMany({
      where: {
        targetType: "TENANT",
        targetId: params.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
      include: {
        superAdmin: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    return { logs };
  });
  done();
};

function getSuperAdmin(request: FastifyRequest) {
  if (!request.superAdmin) {
    throw new Error("Super-admin request was not authenticated");
  }

  return request.superAdmin;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function defaultCycleMonths(cycle: BillingCycle): number {
  switch (cycle) {
    case BillingCycle.MONTHLY:
      return 1;
    case BillingCycle.QUARTERLY:
      return 3;
    case BillingCycle.HALF_YEARLY:
      return 6;
    case BillingCycle.TWO_YEARLY:
      return 24;
    case BillingCycle.THREE_YEARLY:
      return 36;
    case BillingCycle.ONE_TIME:
    case BillingCycle.YEARLY:
      return 12;
  }
}

function formatTenant<T extends object & { license?: { amountPaid: { toString: () => string } } | null }>(tenant: T) {
  return {
    ...tenant,
    license: tenant.license ? formatLicense(tenant.license) : tenant.license,
  };
}

function formatLicense<T extends { amountPaid: { toString: () => string } }>(license: T) {
  return {
    ...license,
    amountPaid: license.amountPaid.toString(),
  };
}
