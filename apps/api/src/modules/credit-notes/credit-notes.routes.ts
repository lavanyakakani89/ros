import { z } from "zod";
import { CreditNoteStatus, type Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";

import { generateCreditNotePdf, type CreditNoteWithItems } from "./credit-note.pdf.js";
import { queueWhatsappNotification } from "../whatsapp/whatsapp.notifications.js";
import { moneyForWhatsapp, renderWhatsappMessageTemplate } from "../whatsapp/whatsapp.templates.js";

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
    const query = z.object({
      status: z.nativeEnum(CreditNoteStatus).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(25),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }).parse(request.query);
    const createdAt = dateRangeWhere(query.from, query.to);
    const where: Prisma.CreditNoteWhereInput = {
      tenantId: request.tenant.id,
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [total, data] = await Promise.all([
      fastify.prisma.creditNote.count({ where }),
      fastify.prisma.creditNote.findMany({
        where,
        include: { customer: true, items: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { data, page: query.page, limit: query.limit, total };
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
        const p = productById.get(item.productId);
        if (!p) {
          throw new CreditNoteError("One or more products not found", 400);
        }
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

  fastify.post("/api/credit-notes/:id/pdf", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      return generateAndStoreCreditNotePdf(fastify, request.tenant.id, id);
    });
  });

  fastify.get("/api/credit-notes/:id/pdf/view", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const pdf = await generateAndStoreCreditNotePdf(fastify, request.tenant.id, id);
      const creditNote = await getCreditNoteOrThrow(fastify, request.tenant.id, id);
      let stream;
      try {
        stream = await fastify.minio.getObject(fastify.minioBucket, pdf.pdfUrl);
      } catch (error) {
        fastify.log.error({ error, tenantId: request.tenant.id, creditNoteId: id, objectName: pdf.pdfUrl }, "Generated credit note PDF was unavailable");
        throw new CreditNoteError("Credit note PDF could not be opened after generation.", 502);
      }
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${creditNote.creditNoteNumber}.pdf"`)
        .header("Cache-Control", "no-store, max-age=0");
      return reply.send(stream);
    });
  });

  fastify.post("/api/credit-notes/:id/share", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const input = z.object({ channel: z.enum(["whatsapp", "pdf"]).default("whatsapp") }).parse(request.body ?? {});
      const creditNote = await getCreditNoteOrThrow(fastify, request.tenant.id, id);

      if (input.channel === "pdf") {
        return generateAndStoreCreditNotePdf(fastify, request.tenant.id, id);
      }

      if (!creditNote.customer?.phone) {
        throw new CreditNoteError("Credit note does not have a customer phone number to share with", 400);
      }

      const pdf = creditNote.pdfUrl
        ? { pdfUrl: creditNote.pdfUrl, downloadUrl: creditNotePdfViewUrl(creditNote.id) }
        : await generateAndStoreCreditNotePdf(fastify, request.tenant.id, id);
      const message = await renderWhatsappMessageTemplate(fastify, request.tenant.id, "creditNoteReady", {
        customerName: creditNote.customer.name,
        tenantName: request.tenant.name,
        creditNoteNumber: creditNote.creditNoteNumber,
        grandTotal: moneyForWhatsapp(creditNote.grandTotal),
        originalInvoiceNumber: creditNote.originalInvoice?.invoiceNumber ?? "-",
        pdfLine: `Download: ${pdf.downloadUrl}`,
      });

      await queueWhatsappNotification(fastify, {
        tenantId: request.tenant.id,
        phone: creditNote.customer.phone,
        customerId: creditNote.customerId,
        message,
        jobName: "credit-note-share",
        eventKey: "creditNoteShared",
      });
      return { status: "queued", channel: input.channel };
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

function dateRangeWhere(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

async function getCreditNoteOrThrow(fastify: FastifyInstance, tenantId: string, id: string): Promise<CreditNoteWithItems> {
  const creditNote = await fastify.prisma.creditNote.findFirst({
    where: { id, tenantId },
    include: { items: true, customer: true, originalInvoice: true },
  });
  if (!creditNote) {
    throw new CreditNoteError("Credit note not found", 404);
  }

  return creditNote;
}

async function generateAndStoreCreditNotePdf(fastify: FastifyInstance, tenantId: string, id: string) {
  const creditNote = await getCreditNoteOrThrow(fastify, tenantId, id);
  const tenant = await fastify.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  let pdfUrl: string;
  try {
    pdfUrl = await generateCreditNotePdf({
      creditNote,
      tenant,
      minio: fastify.minio,
      bucket: fastify.minioBucket,
    });
  } catch (error) {
    fastify.log.error({ error, creditNoteId: id, tenantId }, "Credit note PDF generation failed");
    throw new CreditNoteError(`Credit note PDF generation failed: ${safeErrorMessage(error)}`, 502);
  }

  await fastify.prisma.creditNote.updateMany({
    where: { id, tenantId },
    data: { pdfUrl },
  });

  return {
    pdfUrl,
    downloadUrl: creditNotePdfViewUrl(id),
  };
}

function creditNotePdfViewUrl(creditNoteId: string): string {
  const baseUrl = process.env.PUBLIC_APP_URL ?? (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "");
  return `${baseUrl}/api/credit-notes/${creditNoteId}/pdf/view`;
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown PDF renderer error";
  }

  return error.message.replace(/\s+/g, " ").slice(0, 180) || "Unknown PDF renderer error";
}

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof CreditNoteError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}
