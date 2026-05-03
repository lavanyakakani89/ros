import { z } from "zod";
import type { FastifyPluginCallback } from "fastify";

const createSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  paidAt: z.coerce.date().default(() => new Date()),
  notes: z.string().optional(),
});

export const expensesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/expenses", async (request) => {
    const { page, limit, from, to, category } = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().max(100).default(25),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      category: z.string().optional(),
    }).parse(request.query);

    const where = {
      tenantId: request.tenant.id,
      ...(category ? { category } : {}),
      ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [total, data] = await Promise.all([
      fastify.prisma.expense.count({ where }),
      fastify.prisma.expense.findMany({ where, orderBy: { paidAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    ]);

    const byCategory = data.reduce<Record<string, number>>((acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + e.amount.toNumber();
      return acc;
    }, {});

    return { data, page, limit, total, summary: { total: data.reduce((s, e) => s + e.amount.toNumber(), 0), byCategory } };
  });

  fastify.post("/api/expenses", async (request) => {
    const input = createSchema.parse(request.body);
    return fastify.prisma.expense.create({
      data: {
        tenantId: request.tenant.id,
        createdBy: request.user.userId,
        ...input,
      },
    });
  });

  fastify.delete("/api/expenses/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await fastify.prisma.expense.deleteMany({ where: { id, tenantId: request.tenant.id } });
    if (result.count === 0) return reply.status(404).send({ error: "Expense not found" });
    return { status: "ok" };
  });

  done();
};
