import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

export class CouponError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const createSchema = z.object({
  code: z.string().min(1).max(32).toUpperCase(),
  description: z.string().optional(),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).default("FLAT"),
  discountValue: z.coerce.number().positive(),
  minOrderValue: z.coerce.number().nonnegative().optional(),
  maxDiscount: z.coerce.number().positive().optional(),
  usageLimit: z.coerce.number().int().positive().optional(),
  validFrom: z.coerce.date().default(() => new Date()),
  validUntil: z.coerce.date(),
});

export const couponsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/coupons", async (request) => {
    return fastify.prisma.coupon.findMany({
      where: { tenantId: request.tenant.id },
      orderBy: { createdAt: "desc" },
    });
  });

  fastify.post("/api/coupons", async (request, reply) => {
    return handleError(reply, async () => {
      const input = createSchema.parse(request.body);
      return fastify.prisma.coupon.create({
        data: {
          tenantId: request.tenant.id,
          code: input.code,
          description: input.description ?? null,
          discountType: input.discountType,
          discountValue: input.discountValue,
          minOrderValue: input.minOrderValue ?? null,
          maxDiscount: input.maxDiscount ?? null,
          usageLimit: input.usageLimit ?? null,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
        },
      });
    });
  });

  fastify.post("/api/coupons/validate", async (request, reply) => {
    return handleError(reply, async () => {
      const { code, orderTotal } = z.object({ code: z.string().min(1), orderTotal: z.coerce.number() }).parse(request.body);
      const coupon = await fastify.prisma.coupon.findFirst({
        where: { tenantId: request.tenant.id, code: code.toUpperCase(), isActive: true },
      });

      if (!coupon) throw new CouponError("Coupon not found", 404);
      if (new Date() < coupon.validFrom || new Date() > coupon.validUntil) throw new CouponError("Coupon expired or not yet active", 400);
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) throw new CouponError("Coupon usage limit reached", 400);
      if (coupon.minOrderValue !== null && orderTotal < coupon.minOrderValue.toNumber()) {
        throw new CouponError(`Minimum order value is ₹${coupon.minOrderValue.toNumber().toFixed(2)}`, 400);
      }

      let discount = coupon.discountType === "FLAT"
        ? coupon.discountValue.toNumber()
        : (orderTotal * coupon.discountValue.toNumber()) / 100;

      if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount.toNumber());
      discount = Math.min(discount, orderTotal);

      return { discount: Math.round(discount * 100) / 100, couponId: coupon.id, code: coupon.code };
    });
  });

  fastify.put("/api/coupons/:id", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const input = createSchema.partial().parse(request.body);
      const data = {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
        ...(input.discountValue !== undefined ? { discountValue: input.discountValue } : {}),
        ...(input.minOrderValue !== undefined ? { minOrderValue: input.minOrderValue } : {}),
        ...(input.maxDiscount !== undefined ? { maxDiscount: input.maxDiscount } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
        ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
      };
      return fastify.prisma.coupon.updateMany({ where: { id, tenantId: request.tenant.id }, data });
    });
  });

  fastify.delete("/api/coupons/:id", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      await fastify.prisma.coupon.updateMany({ where: { id, tenantId: request.tenant.id }, data: { isActive: false } });
      return { status: "ok" };
    });
  });

  done();
};

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof CouponError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}
