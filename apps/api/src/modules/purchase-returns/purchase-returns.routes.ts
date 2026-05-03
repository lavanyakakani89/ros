import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

export class PurchaseReturnError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const itemSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().default("piece"),
  purchasePrice: z.coerce.number().nonnegative(),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  purchaseOrderId: z.string().min(1).optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

const idParams = z.object({ id: z.string().min(1) });

export const purchaseReturnsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/purchase-returns", async (request) => {
    const { page, limit } = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().max(100).default(25) }).parse(request.query);
    const [total, data] = await Promise.all([
      fastify.prisma.purchaseReturn.count({ where: { tenantId: request.tenant.id } }),
      fastify.prisma.purchaseReturn.findMany({
        where: { tenantId: request.tenant.id },
        include: { supplier: true, items: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, page, limit, total };
  });

  fastify.post("/api/purchase-returns", async (request, reply) => {
    return handleError(reply, async () => {
      const input = createSchema.parse(request.body);
      const now = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const counter = await fastify.prisma.$transaction(async (tx) => {
        const rec = await tx.invoiceCounter.upsert({
          where: { tenantId_date: { tenantId: request.tenant.id, date: `PR-${now}` } },
          create: { tenantId: request.tenant.id, date: `PR-${now}`, nextSeq: 2 },
          update: { nextSeq: { increment: 1 } },
        });
        return `PR-${now}-${String(rec.nextSeq - 1).padStart(4, "0")}`;
      });

      const totalAmount = input.items.reduce((s, i) => s + i.quantity * i.purchasePrice, 0);
      return fastify.prisma.purchaseReturn.create({
        data: {
          tenantId: request.tenant.id,
          returnNumber: counter,
          supplierId: input.supplierId,
          ...(input.purchaseOrderId ? { purchaseOrderId: input.purchaseOrderId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          totalAmount,
          items: {
            createMany: {
              data: input.items.map((item) => ({
              tenantId: request.tenant.id,
              productId: item.productId ?? null,
              productName: item.productName,
              quantity: item.quantity,
              unit: item.unit,
              purchasePrice: item.purchasePrice,
              total: item.quantity * item.purchasePrice,
            })),
            },
          },
        },
        include: { supplier: true, items: true },
      });
    });
  });

  fastify.post("/api/purchase-returns/:id/confirm", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const pr = await fastify.prisma.purchaseReturn.findFirst({ where: { id, tenantId: request.tenant.id }, include: { items: true } });
      if (!pr) throw new PurchaseReturnError("Purchase return not found", 404);
      if (pr.status !== "DRAFT") throw new PurchaseReturnError("Only draft returns can be confirmed", 409);

      await fastify.prisma.$transaction(async (tx) => {
        // Deduct returned items from stock
        for (const item of pr.items) {
          if (item.productId) {
            await tx.product.update({ where: { id: item.productId }, data: { currentStock: { decrement: item.quantity } } });
          }
        }
        await tx.purchaseReturn.update({ where: { id }, data: { status: "CONFIRMED" } });
      });

      return { status: "ok" };
    });
  });

  done();
};

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof PurchaseReturnError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}
