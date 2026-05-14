import { LoyaltyTxType, UserRole } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

const POINTS_PER_RUPEE = Number(process.env.LOYALTY_POINTS_PER_RUPEE ?? "1");
const POINTS_EXPIRY_DAYS = Number(process.env.LOYALTY_POINTS_EXPIRY_DAYS ?? "365");

export class LoyaltyError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const idParams = z.object({ id: z.string().min(1) });
const customerIdParams = z.object({ customerId: z.string().min(1) });
const tierInputSchema = z.object({
  name: z.string().trim().min(2),
  minPoints: z.coerce.number().int().min(0),
  multiplier: z.coerce.number().min(0.1).max(10),
  color: z.string().trim().min(4).max(32).default("#6b7280"),
});
const updateTierSchema = tierInputSchema.partial();
const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
});

export const loyaltyRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/loyalty/tiers", async (request, reply) => {
    return handleError(reply, async () => fastify.prisma.loyaltyTier.findMany({
      where: { tenantId: request.tenant.id },
      orderBy: [{ minPoints: "asc" }, { sortOrder: "asc" }],
    }));
  });

  fastify.post("/api/loyalty/tiers", async (request, reply) => {
    return handleError(reply, async () => {
      ensureManager(request.user.role);
      const input = tierInputSchema.parse(request.body);
      return fastify.prisma.loyaltyTier.create({
        data: {
          tenantId: request.tenant.id,
          name: input.name,
          minPoints: input.minPoints,
          multiplier: input.multiplier,
          color: input.color,
        },
      });
    });
  });

  fastify.put("/api/loyalty/tiers/:id", async (request, reply) => {
    return handleError(reply, async () => {
      ensureManager(request.user.role);
      const { id } = idParams.parse(request.params);
      const input = updateTierSchema.parse(request.body);
      const data = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.minPoints !== undefined ? { minPoints: input.minPoints } : {}),
        ...(input.multiplier !== undefined ? { multiplier: input.multiplier } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      };
      const result = await fastify.prisma.loyaltyTier.updateMany({
        where: { id, tenantId: request.tenant.id },
        data,
      });
      if (result.count === 0) throw new LoyaltyError("Loyalty tier not found", 404);
      return fastify.prisma.loyaltyTier.findFirst({ where: { id, tenantId: request.tenant.id } });
    });
  });

  fastify.delete("/api/loyalty/tiers/:id", async (request, reply) => {
    return handleError(reply, async () => {
      ensureManager(request.user.role);
      const { id } = idParams.parse(request.params);
      const assigned = await fastify.prisma.customer.count({ where: { tenantId: request.tenant.id, tierId: id } });
      if (assigned > 0) throw new LoyaltyError("Cannot delete a tier assigned to customers", 409);
      await fastify.prisma.loyaltyTier.deleteMany({ where: { id, tenantId: request.tenant.id } });
      return { status: "ok" };
    });
  });

  fastify.get("/api/loyalty/customers", async (request, reply) => {
    return handleError(reply, async () => {
      const query = customerListQuerySchema.parse(request.query);
      const where = {
        tenantId: request.tenant.id,
        ...(query.search ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search } },
          ],
        } : {}),
      };
      const [rows, total] = await fastify.prisma.$transaction([
        fastify.prisma.customer.findMany({
          where,
          include: {
            tier: true,
            loyaltyAccount: {
              include: {
                transactions: {
                  where: { type: LoyaltyTxType.EARNED },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                },
              },
            },
          },
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        fastify.prisma.customer.count({ where }),
      ]);

      return {
        data: rows.map((customer) => ({
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          tier: customer.tier,
          points: customer.loyaltyAccount?.points ?? 0,
          lastEarnDate: customer.loyaltyAccount?.transactions[0]?.createdAt ?? null,
        })),
        page: query.page,
        limit: query.limit,
        total,
      };
    });
  });

  fastify.get("/api/loyalty/:customerId", async (request, reply) => {
    return handleError(reply, async () => {
      const { customerId } = customerIdParams.parse(request.params);
      const account = await fastify.prisma.loyaltyAccount.findFirst({
        where: { tenantId: request.tenant.id, customerId },
      });
      return { points: account?.points ?? 0, customerId };
    });
  });

  fastify.post("/api/loyalty/earn", async (request, reply) => {
    return handleError(reply, async () => {
      const { customerId, invoiceId, orderTotal } = z.object({
        customerId: z.string().min(1),
        invoiceId: z.string().min(1),
        orderTotal: z.coerce.number().positive(),
      }).parse(request.body);

      const customer = await fastify.prisma.customer.findFirst({
        where: { id: customerId, tenantId: request.tenant.id },
        include: { tier: true },
      });
      if (!customer) throw new LoyaltyError("Customer not found", 404);

      const basePoints = Math.floor(orderTotal * POINTS_PER_RUPEE);
      const multiplier = customer.tier?.multiplier.toNumber() ?? 1;
      const points = Math.floor(basePoints * multiplier);
      if (points <= 0) return { points: 0 };

      const account = await fastify.prisma.loyaltyAccount.upsert({
        where: { tenantId_customerId: { tenantId: request.tenant.id, customerId } },
        create: { tenantId: request.tenant.id, customerId, points },
        update: { points: { increment: points } },
      });

      await fastify.prisma.loyaltyTransaction.create({
        data: {
          tenantId: request.tenant.id,
          accountId: account.id,
          points,
          type: LoyaltyTxType.EARNED,
          referenceId: invoiceId,
          expiresAt: loyaltyExpiryDate(),
        },
      });

      await Promise.all([
        fastify.prisma.invoice.update({ where: { id: invoiceId }, data: { loyaltyPointsEarned: points } }),
        recalculateCustomerTier(fastify, request.tenant.id, customerId),
      ]);

      return { points, totalPoints: account.points };
    });
  });

  fastify.post("/api/loyalty/redeem", async (request, reply) => {
    return handleError(reply, async () => {
      const { customerId, invoiceId, points } = z.object({
        customerId: z.string().min(1),
        invoiceId: z.string().min(1),
        points: z.coerce.number().int().positive(),
      }).parse(request.body);

      const account = await fastify.prisma.loyaltyAccount.findFirst({
        where: { tenantId: request.tenant.id, customerId },
      });

      if (!account || account.points < points) throw new LoyaltyError("Insufficient loyalty points", 400);

      await fastify.prisma.$transaction([
        fastify.prisma.loyaltyAccount.update({ where: { id: account.id }, data: { points: { decrement: points } } }),
        fastify.prisma.loyaltyTransaction.create({
          data: { tenantId: request.tenant.id, accountId: account.id, points: -points, type: LoyaltyTxType.REDEEMED, referenceId: invoiceId },
        }),
        fastify.prisma.invoice.update({ where: { id: invoiceId }, data: { loyaltyPointsRedeemed: points } }),
      ]);

      return { pointsRedeemed: points, remainingPoints: account.points - points };
    });
  });

  fastify.post("/api/loyalty/admin-adjust/:customerId", async (request, reply) => {
    return handleError(reply, async () => {
      ensureManager(request.user.role);
      const { customerId } = customerIdParams.parse(request.params);
      const input = z.object({
        points: z.coerce.number().int().refine((value) => value !== 0, "Points cannot be zero"),
        reason: z.string().trim().min(3),
      }).parse(request.body);
      const account = await fastify.prisma.loyaltyAccount.upsert({
        where: { tenantId_customerId: { tenantId: request.tenant.id, customerId } },
        create: { tenantId: request.tenant.id, customerId, points: 0 },
        update: {},
      });
      if (account.points + input.points < 0) throw new LoyaltyError("Adjustment would make points negative", 400);

      await fastify.prisma.$transaction([
        fastify.prisma.loyaltyAccount.update({ where: { id: account.id }, data: { points: { increment: input.points } } }),
        fastify.prisma.loyaltyTransaction.create({
          data: {
            tenantId: request.tenant.id,
            accountId: account.id,
            points: input.points,
            type: LoyaltyTxType.MANUAL_ADJUST,
            notes: input.reason,
          },
        }),
      ]);
      await recalculateCustomerTier(fastify, request.tenant.id, customerId);
      return { status: "ok" };
    });
  });

  fastify.get("/api/loyalty/:customerId/transactions", async (request, reply) => {
    return handleError(reply, async () => {
      const { customerId } = customerIdParams.parse(request.params);
      const account = await fastify.prisma.loyaltyAccount.findFirst({
        where: { tenantId: request.tenant.id, customerId },
        include: { customer: { include: { tier: true } }, transactions: { orderBy: { createdAt: "desc" }, take: 50 } },
      });
      return { account, points: account?.points ?? 0, transactions: account?.transactions ?? [] };
    });
  });

  done();
};

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof LoyaltyError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}

function ensureManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new LoyaltyError("Only owners and managers can manage loyalty settings", 403);
  }
}

function loyaltyExpiryDate(): Date {
  return new Date(Date.now() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

async function recalculateCustomerTier(fastify: FastifyInstance, tenantId: string, customerId: string): Promise<void> {
  const account = await fastify.prisma.loyaltyAccount.findFirst({
    where: { tenantId, customerId },
    include: { transactions: true },
  });
  const lifetimePoints = (account?.transactions ?? [])
    .filter((transaction) => transaction.type === LoyaltyTxType.EARNED)
    .reduce((sum, transaction) => sum + Math.max(transaction.points, 0), 0);
  const tier = await fastify.prisma.loyaltyTier.findFirst({
    where: { tenantId, minPoints: { lte: lifetimePoints } },
    orderBy: { minPoints: "desc" },
  });

  await fastify.prisma.customer.updateMany({
    where: { id: customerId, tenantId },
    data: { tierId: tier?.id ?? null },
  });
}
