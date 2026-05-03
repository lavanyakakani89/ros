import { z } from "zod";
import { PaymentMode } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

export class CreditNoteError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  discount: z.coerce.number().nonnegative().default(0),
});

const createSchema = z.object({
  originalInvoiceId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional(),
  items: z.array(itemSchema).min(1),
});

const idParams = z.object({ id: z.string().min(1) });

export const creditNotesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/credit-notes", async (request) => {
    const { page, limit } = z.object({ page: z.coerce.number().default(1), limit: z.coerce.number().max(100).default(25) }).parse(request.query);
    const [total, data] = await Promise.all([
      fastify.prisma.creditNote.count({ where: { tenantId: request.tenant.id } }),
      fastify.prisma.creditNote.findMany({
        where: { tenantId: request.tenant.id },
        include: { customer: true, items: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, page, limit, total };
  });

  fastify.post("/api/credit-notes", async (request, reply) => {
    return handleError(reply, async () => {
      const input = createSchema.parse(request.body);
      const products = await fastify.prisma.product.findMany({
        where: { tenantId: request.tenant.id, id: { in: input.items.map((i) => i.productId) } },
      });
      const productById = new Map(products.map((p) => [p.id, p]));
      if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
        throw new CreditNoteError("One or more products not found", 400);
      }

      const calcItems = input.items.map((item) => {
        const p = productById.get(item.productId)!;
        const qty = item.quantity;
        const taxable = Math.max(p.sellingPrice.toNumber() * qty - item.discount, 0);
        const gstRate = p.gstRate.toNumber();
        const cgst = Math.round((taxable * gstRate / 200) * 100) / 100;
        const sgst = cgst;
        const total = taxable + cgst + sgst;
        return { tenantId: request.tenant.id, productId: p.id, productName: p.name, quantity: qty, unit: p.unit, sellingPrice: p.sellingPrice, discount: item.discount, gstRate: p.gstRate, cgst, sgst, total };
      });

      const subtotal = calcItems.reduce((s, i) => s + Number(i.sellingPrice) * i.quantity, 0);
      const totalCgst = calcItems.reduce((s, i) => s + i.cgst, 0);
      const totalSgst = calcItems.reduce((s, i) => s + i.sgst, 0);
      const grandTotal = calcItems.reduce((s, i) => s + i.total, 0);

      const counter = await fastify.prisma.$transaction(async (tx) => {
        const now = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const key = `CN-${request.tenant.id}-${now}`;
        const existing = await tx.invoiceCounter.upsert({
          where: { tenantId_date: { tenantId: request.tenant.id, date: `CN-${now}` } },
          create: { tenantId: request.tenant.id, date: `CN-${now}`, nextSeq: 2 },
          update: { nextSeq: { increment: 1 } },
        });
        return `CN-${now}-${String(existing.nextSeq - 1).padStart(4, "0")}`;
      });

      return fastify.prisma.creditNote.create({
        data: {
          tenantId: request.tenant.id,
          creditNoteNumber: counter,
          ...(input.originalInvoiceId ? { originalInvoiceId: input.originalInvoiceId } : {}),
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          subtotal,
          totalCgst,
          totalSgst,
          grandTotal,
          items: { create: calcItems },
        },
        include: { items: true, customer: true },
      });
    });
  });

  fastify.post("/api/credit-notes/:id/confirm", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const cn = await fastify.prisma.creditNote.findFirst({ where: { id, tenantId: request.tenant.id }, include: { items: true } });
      if (!cn) throw new CreditNoteError("Credit note not found", 404);
      if (cn.status !== "DRAFT") throw new CreditNoteError("Only draft credit notes can be confirmed", 409);

      // Restore stock for returned items
      await fastify.prisma.$transaction(async (tx) => {
        for (const item of cn.items) {
          await tx.product.update({ where: { id: item.productId }, data: { currentStock: { increment: item.quantity } } });
        }
        await tx.creditNote.update({ where: { id }, data: { status: "CONFIRMED" } });
      });

      return { status: "ok" };
    });
  });

  fastify.get("/api/credit-notes/:id", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const cn = await fastify.prisma.creditNote.findFirst({ where: { id, tenantId: request.tenant.id }, include: { items: { include: { product: true } }, customer: true } });
      if (!cn) throw new CreditNoteError("Credit note not found", 404);
      return cn;
    });
  });

  done();
};

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof CreditNoteError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}
