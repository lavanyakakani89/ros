import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

const createSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  paidAt: z.coerce.date().default(() => new Date()),
  storeId: z.string().min(1).optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  category: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  amount: z.coerce.number().positive().optional(),
  paidAt: z.coerce.date().optional(),
  storeId: z.string().min(1).nullable().optional(),
  notes: z.string().optional(),
});

class ExpenseError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

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
    const { page, limit, from, to, category, storeId } = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().max(100).default(25),
      from: z.string().optional(),
      to: z.string().optional(),
      category: z.string().optional(),
      storeId: z.string().min(1).optional(),
    }).parse(request.query);

    const fromDate = parseDateFilter(from);
    const toDate = parseDateFilter(to);
    const toExclusive = toDate ? getNextDate(toDate) : undefined;

    const where = {
      tenantId: request.tenant.id,
      ...(category ? { category } : {}),
      ...storeIdForRead(request.user.role, request.storeId, storeId),
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
        ...storeIdForWrite(request.user.role, request.storeId, input.storeId),
        createdBy: request.user.userId,
        category: input.category,
        description: input.description,
        amount: input.amount,
        paidAt: input.paidAt,
        notes: input.notes ?? null,
      },
    });
  });

  fastify.put("/api/expenses/:id", async (request, reply) => {
    return handleExpense(reply, async () => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const input = updateSchema.parse(request.body);
      const result = await fastify.prisma.expense.updateMany({
        where: {
          id,
          tenantId: request.tenant.id,
        },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.paidAt !== undefined ? { paidAt: input.paidAt } : {}),
          ...(input.storeId !== undefined ? storeIdForWrite(request.user.role, request.storeId, input.storeId ?? undefined, true) : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        },
      });
      if (result.count === 0) {
        throw new ExpenseError("Expense not found", 404);
      }

      const expense = await fastify.prisma.expense.findFirstOrThrow({
        where: {
          id,
          tenantId: request.tenant.id,
        },
      });
      const auditChanges = {
        ...input,
        ...(input.paidAt ? { paidAt: input.paidAt.toISOString() } : {}),
      };
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "EXPENSE_UPDATED",
          entity: "EXPENSE",
          entityId: expense.id,
          changes: auditChanges,
          ip: request.ip,
        },
      });

      return expense;
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

async function handleExpense<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ExpenseError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}

function storeIdForRead(role: string, sessionStoreId: string | null | undefined, requestedStoreId: string | undefined): { storeId?: string } {
  if (role === "OWNER" || role === "MANAGER") {
    return requestedStoreId ? { storeId: requestedStoreId } : sessionStoreId ? { storeId: sessionStoreId } : {};
  }

  return sessionStoreId ? { storeId: sessionStoreId } : requestedStoreId ? { storeId: requestedStoreId } : {};
}

function storeIdForWrite(
  role: string,
  sessionStoreId: string | null | undefined,
  requestedStoreId: string | undefined,
  allowClear = false,
): { storeId?: string | null } {
  if (role === "OWNER" || role === "MANAGER") {
    if (requestedStoreId) return { storeId: requestedStoreId };
    if (allowClear) return { storeId: null };
    return sessionStoreId ? { storeId: sessionStoreId } : {};
  }

  return sessionStoreId ? { storeId: sessionStoreId } : {};
}
