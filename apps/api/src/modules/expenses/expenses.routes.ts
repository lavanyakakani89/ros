import { z } from "zod";
import type { FastifyPluginCallback } from "fastify";

const createSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  paidAt: z.coerce.date().default(() => new Date()),
  notes: z.string().optional(),
});

function parseDateFilter(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function getNextDate(value: Date) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export const expensesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/expenses", async (request) => {
    const { page, limit, from, to, category } = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().max(100).default(25),
      from: z.string().optional(),
      to: z.string().optional(),
      category: z.string().optional(),
    }).parse(request.query);

    const fromDate = parseDateFilter(from);
    const toDate = parseDateFilter(to);
    const toExclusive = toDate ? getNextDate(toDate) : undefined;

    const where = {
      tenantId: request.tenant.id,
      ...(category ? { category } : {}),
      ...(fromDate || toExclusive ? { paidAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
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
        category: input.category,
        description: input.description,
        amount: input.amount,
        paidAt: input.paidAt,
        notes: input.notes ?? null,
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
