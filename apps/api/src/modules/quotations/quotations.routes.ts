import { z } from "zod";
import { QuotationStatus, type Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";

import { generateQuotationPdf, type QuotationWithItems } from "./quotation.pdf.js";
import { queueWhatsappNotification } from "../whatsapp/whatsapp.notifications.js";
import { moneyForWhatsapp, renderWhatsappMessageTemplate } from "../whatsapp/whatsapp.templates.js";

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
    const query = z.object({
      status: z.nativeEnum(QuotationStatus).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(25),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }).parse(request.query);
    const createdAt = dateRangeWhere(query.from, query.to);
    const where: Prisma.QuotationWhereInput = {
      tenantId: request.tenant.id,
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [total, data] = await Promise.all([
      fastify.prisma.quotation.count({ where }),
      fastify.prisma.quotation.findMany({
        where,
        include: { customer: true, items: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { data, page: query.page, limit: query.limit, total };
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

  fastify.post("/api/quotations/:id/pdf", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      return generateAndStoreQuotationPdf(fastify, request.tenant, id);
    });
  });

  fastify.get("/api/quotations/:id/pdf/view", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const pdf = await generateAndStoreQuotationPdf(fastify, request.tenant, id);
      const quotation = await getQuotationOrThrow(fastify, request.tenant.id, id);
      let stream;
      try {
        stream = await fastify.minio.getObject(fastify.minioBucket, pdf.pdfUrl);
      } catch (error) {
        fastify.log.error({ error, tenantId: request.tenant.id, quotationId: id, objectName: pdf.pdfUrl }, "Generated quotation PDF was unavailable");
        throw new QuotationError("Quotation PDF could not be opened after generation.", 502);
      }
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${quotation.quotationNumber}.pdf"`)
        .header("Cache-Control", "no-store, max-age=0");
      return reply.send(stream);
    });
  });

  fastify.post("/api/quotations/:id/share", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      const input = z.object({ channel: z.enum(["whatsapp", "pdf"]).default("whatsapp") }).parse(request.body ?? {});
      return shareQuotation(fastify, request.tenant, id, input.channel);
    });
  });

  fastify.post("/api/quotations/:id/send-whatsapp", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = idParams.parse(request.params);
      return shareQuotation(fastify, request.tenant, id, "whatsapp");
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

function dateRangeWhere(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

async function getQuotationOrThrow(fastify: FastifyInstance, tenantId: string, id: string): Promise<QuotationWithItems> {
  const quotation = await fastify.prisma.quotation.findFirst({
    where: { id, tenantId },
    include: { items: true, customer: true },
  });
  if (!quotation) {
    throw new QuotationError("Quotation not found", 404);
  }

  return quotation;
}

async function shareQuotation(
  fastify: FastifyInstance,
  tenant: Parameters<typeof generateAndStoreQuotationPdf>[1],
  id: string,
  channel: "whatsapp" | "pdf",
) {
  const quotation = await getQuotationOrThrow(fastify, tenant.id, id);

  if (channel === "pdf") {
    return generateAndStoreQuotationPdf(fastify, tenant, id);
  }

  if (!quotation.customer?.phone) {
    throw new QuotationError("Quotation does not have a customer phone number to share with", 400);
  }

  const pdf = quotation.pdfUrl
    ? { pdfUrl: quotation.pdfUrl, downloadUrl: quotationPdfViewUrl(quotation.id) }
    : await generateAndStoreQuotationPdf(fastify, tenant, id);
  const message = await renderWhatsappMessageTemplate(fastify, tenant.id, "quotationReady", {
    customerName: quotation.customer.name,
    tenantName: tenant.name,
    quotationNumber: quotation.quotationNumber,
    grandTotal: moneyForWhatsapp(quotation.grandTotal),
    validUntil: quotation.validUntil?.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) ?? "-",
    pdfLine: `Download: ${pdf.downloadUrl}`,
  });

  await queueWhatsappNotification(fastify, {
    tenantId: tenant.id,
    phone: quotation.customer.phone,
    customerId: quotation.customerId,
    message,
    jobName: "quotation-share",
    eventKey: "quotationShared",
  });
  return { status: "queued", channel };
}

async function generateAndStoreQuotationPdf(fastify: FastifyInstance, tenant: { id: string; name: string }, id: string) {
  const quotation = await getQuotationOrThrow(fastify, tenant.id, id);
  let pdfUrl: string;
  try {
    pdfUrl = await generateQuotationPdf({
      quotation,
      tenant: await fastify.prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }),
      minio: fastify.minio,
      bucket: fastify.minioBucket,
    });
  } catch (error) {
    fastify.log.error({ error, quotationId: id, tenantId: tenant.id }, "Quotation PDF generation failed");
    throw new QuotationError(`Quotation PDF generation failed: ${safeErrorMessage(error)}`, 502);
  }

  await fastify.prisma.quotation.updateMany({
    where: { id, tenantId: tenant.id },
    data: { pdfUrl },
  });

  return {
    pdfUrl,
    downloadUrl: quotationPdfViewUrl(id),
  };
}

function quotationPdfViewUrl(quotationId: string): string {
  const baseUrl = process.env.PUBLIC_APP_URL ?? (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "");
  return `${baseUrl}/api/quotations/${quotationId}/pdf/view`;
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
    if (error instanceof QuotationError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}
