import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

const POINTS_PER_RUPEE = Number(process.env.LOYALTY_POINTS_PER_RUPEE ?? "1");

export class LoyaltyError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

export const loyaltyRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/loyalty/:customerId", async (request, reply) => {
    return handleError(reply, async () => {
      const { customerId } = z.object({ customerId: z.string().min(1) }).parse(request.params);
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

      const points = Math.floor(orderTotal * POINTS_PER_RUPEE);
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
          type: "EARNED",
          referenceId: invoiceId,
        },
      });

      await fastify.prisma.invoice.update({ where: { id: invoiceId }, data: { loyaltyPointsEarned: points } });

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
          data: { tenantId: request.tenant.id, accountId: account.id, points: -points, type: "REDEEMED", referenceId: invoiceId },
        }),
        fastify.prisma.invoice.update({ where: { id: invoiceId }, data: { loyaltyPointsRedeemed: points } }),
      ]);

      return { pointsRedeemed: points, remainingPoints: account.points - points };
    });
  });

  fastify.get("/api/loyalty/:customerId/transactions", async (request, reply) => {
    return handleError(reply, async () => {
      const { customerId } = z.object({ customerId: z.string().min(1) }).parse(request.params);
      const account = await fastify.prisma.loyaltyAccount.findFirst({
        where: { tenantId: request.tenant.id, customerId },
        include: { transactions: { orderBy: { createdAt: "desc" }, take: 50 } },
      });
      return { points: account?.points ?? 0, transactions: account?.transactions ?? [] };
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
