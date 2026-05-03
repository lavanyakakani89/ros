import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

export class QuotationError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const itemSchema = z.object({
  productId: z.string().min(1).optional(),
  productName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().default("piece"),
  sellingPrice: z.coerce.number().nonnegative(),
  discount: z.coerce.number().nonnegative().default(0),
  gstRate: z.coerce.number().nonnegative().default(0),
});

const createSchema = z.object({
  customerId: z.string().min(1).optional(),
  validUntil: z.coerce.date().optional(),
  notes: z.string().trim().optional(),
  items: z.array(itemSchema).min(1),
});

const idParams = z.object({ id: z.string().min(1) });

function calcItems(tenantId: string, quotationId: string, items: z.infer<typeof createSchema>["items"]) {
  return items.map((item) => {
    const taxable = Math.max(item.sellingPrice * item.quantity - item.discount, 0);
    const gst = taxable * (item.gstRate / 100);
    const total = taxable + gst;
    return { tenantId, quotationId, productId: item.productId ?? null, productName: item.productName, quantity: item.quantity, unit: item.unit, sellingPrice: item.sellingPrice, discount: item.discount, gstRate: item.gstRate, total };
  });
}

export const quotationsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/quotations", async (request) => {
    const { page, limit } = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().max(100).default(25) }).parse(request.query);
    const [total, data] = await Promise.all([
      fastify.prisma.quotation.count({ where: { tenantId: request.tenant.id } }),
      fastify.prisma.quotation.findMany({
        where: { tenantId: request.tenant.id },
        include: { customer: true, items: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, page, limit, total };
  });

  fastify.post("/api/quotations", async (request, reply) => {
    return handleError(reply, async () => {
      const input = createSchema.parse(request.body);
      const now = new Date().toISOString().slice(0, 10).replaceAll("-", "");

      const counter = await fastify.prisma.$transaction(async (tx) => {
        const rec = await tx.invoiceCounter.upsert({
          where: { tenantId_date: { tenantId: request.tenant.id, date: `QT-${now}` } },
          create: { tenantId: request.tenant.id, date: `QT-${now}`, nextSeq: 2 },
          update: { nextSeq: { increment: 1 } },
        });
        return `QT-${now}-${String(rec.nextSeq - 1).padStart(4, "0")}`;
      });

      const items = input.items;
      const subtotal = items.reduce((s, i) => s + i.sellingPrice * i.quantity, 0);
      const grandTotal = items.reduce((s, i) => {
        const taxable = Math.max(i.sellingPrice * i.quantity - i.discount, 0);
        return s + taxable + taxable * (i.gstRate / 100);
      }, 0);

      const quotation = await fastify.prisma.quotation.create({
        data: {
          tenantId: request.tenant.id,
          quotationNumber: counter,
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(input.validUntil ? { validUntil: input.validUntil } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          subtotal,
          grandTotal,
        },
        include: { customer: true },
      });

      await fastify.prisma.quotationItem.createMany({
        data: calcItems(request.tenant.id, quotation.id, items),
      });

      return fastify.prisma.quotation.findFirst({ where: { id: quotation.id }, include: { items: true, customer: true } });
    });
  });

  fastify.post("/api/quotations/:id/convert", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const quotation = await fastify.prisma.quotation.findFirst({ where: { id, tenantId: request.tenant.id }, include: { items: true } });
      if (!quotation) throw new QuotationError("Quotation not found", 404);
      if (quotation.status === "CONVERTED") throw new QuotationError("Already converted", 409);

      // Delegate to billing routes logic — just return payload for frontend to submit
      return {
        suggestedPayload: {
          customerId: quotation.customerId,
          notes: quotation.notes,
          items: quotation.items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            discount: Number(item.discount),
          })).filter((i) => i.productId),
        },
        quotationId: id,
      };
    });
  });

  fastify.put("/api/quotations/:id/status", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const { status } = z.object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CONVERTED", "EXPIRED"]) }).parse(request.body);
      return fastify.prisma.quotation.updateMany({ where: { id, tenantId: request.tenant.id }, data: { status } });
    });
  });

  done();
};

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof QuotationError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}
