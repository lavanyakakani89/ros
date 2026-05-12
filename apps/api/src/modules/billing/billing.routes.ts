import { z } from "zod";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { BillingError, BillingService } from "./billing.service.js";
import { createInvoiceSchema, invoiceIdParamsSchema, invoiceListQuerySchema, updateInvoiceSchema } from "./billing.schema.js";
import { whatsappNotifyQueue } from "../../jobs/whatsapp-notify.job.js";

export const billingRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new BillingService(fastify);

  fastify.post("/api/billing/invoices", async (request, reply) => {
    const input = createInvoiceSchema.parse(request.body);
    return handleBilling(reply, () => service.createInvoice(request.tenant, input));
  });

  fastify.get("/api/billing/invoices", async (request, reply) => {
    const query = invoiceListQuerySchema.parse(request.query);
    return handleBilling(reply, () => Promise.resolve(service.listInvoices(request.tenant, query)));
  });

  fastify.get("/api/billing/invoices/:id", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.getInvoice(request.tenant, params.id));
  });

  fastify.put("/api/billing/invoices/:id", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    const input = updateInvoiceSchema.parse(request.body);
    return handleBilling(reply, () => service.updateInvoice(request.tenant, params.id, input, request.user.userId));
  });

  fastify.post("/api/billing/invoices/:id/confirm", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.confirmInvoice(request.tenant, params.id, request.user.userId));
  });

  fastify.post("/api/billing/invoices/:id/cancel", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.cancelInvoice(request.tenant, params.id));
  });

  fastify.post("/api/billing/invoices/:id/pdf", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.generateInvoicePdf(request.tenant, params.id));
  });

  fastify.get("/api/billing/invoices/:id/pdf", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.getInvoicePdfUrl(request.tenant, params.id));
  });

  fastify.get("/api/billing/invoices/:id/pdf/view", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, async () => {
      const invoice = await service.getInvoice(request.tenant, params.id);
      const pdf = await service.generateInvoicePdf(request.tenant, params.id);

      let stream;
      try {
        stream = await fastify.minio.getObject(fastify.minioBucket, pdf.objectName);
      } catch (error) {
        fastify.log.error(
          {
            error,
            invoiceId: params.id,
            tenantId: request.tenant.id,
            objectName: pdf.objectName,
            templateId: pdf.templateId,
            templateName: pdf.templateName,
          },
          "Generated invoice PDF was unavailable",
        );
        throw new BillingError("Invoice PDF could not be opened after generation.", 502);
      }
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.pdf"`)
        .header("Cache-Control", "no-store, max-age=0")
        .header("X-RetailOS-Template-Id", pdf.templateId ?? "")
        .header("X-RetailOS-Template-Name", pdf.templateName);
      return reply.send(stream);
    });
  });

  fastify.post("/api/billing/invoices/:id/print", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.printInvoice(request.tenant, params.id));
  });

  fastify.post("/api/billing/invoices/:id/share", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, async () => {
      const input = z.object({ channel: z.enum(["whatsapp", "pdf"]).default("whatsapp") }).parse(request.body ?? {});
      const invoice = await service.getInvoice(request.tenant, params.id);
      const customer = invoice.customerId
        ? await fastify.prisma.customer.findFirst({ where: { id: invoice.customerId, tenantId: request.tenant.id } })
        : null;

      if (input.channel === "pdf") {
        return service.generateInvoicePdf(request.tenant, params.id);
      }

      if (!customer) {
        throw new BillingError("Invoice does not have a customer to share with", 400);
      }

      const pdf = invoice.pdfUrl
        ? await service.getInvoicePdfUrl(request.tenant, params.id)
        : await service.generateInvoicePdf(request.tenant, params.id);
      const message = `Hi ${customer.name}, your invoice ${invoice.invoiceNumber} from ${request.tenant.name} is ready. Download: ${pdf.downloadUrl}`;

      await whatsappNotifyQueue.add("invoice-share", { tenantId: request.tenant.id, phone: customer.phone, message });
      return { status: "queued", channel: input.channel };
    });
  });

  // Share invoice via WhatsApp to customer
  fastify.post("/api/billing/invoices/share-whatsapp", async (request, reply) => {
    return handleBilling(reply, async () => {
      const { customerId, pdfUrl } = z.object({ customerId: z.string().min(1), pdfUrl: z.string().url() }).parse(request.body);
      const customer = await fastify.prisma.customer.findFirst({ where: { id: customerId, tenantId: request.tenant.id } });
      if (!customer) throw new BillingError("Customer not found", 404);
      const message = `Hi ${customer.name}, your invoice from ${request.tenant.name} is ready. Download: ${pdfUrl}`;
      await whatsappNotifyQueue.add("invoice-share", { tenantId: request.tenant.id, phone: customer.phone, message });
      return { status: "queued" };
    });
  });

  // Customer ledger — all invoices + payments for a customer
  fastify.get("/api/billing/customer-ledger/:customerId", async (request) => {
    const { customerId } = z.object({ customerId: z.string().min(1) }).parse(request.params);
    const query = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(25),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }).parse(request.query);
    const customer = await fastify.prisma.customer.findFirst({ where: { id: customerId, tenantId: request.tenant.id } });
    if (!customer) {
      throw new BillingError("Customer not found", 404);
    }

    const invoices = await fastify.prisma.invoice.findMany({
      where: { tenantId: request.tenant.id, customerId, status: { not: "CANCELLED" } },
      include: {
        payments: { orderBy: { paidAt: "asc" } },
      },
      orderBy: { invoiceDate: "asc" },
    });
    const totalBilled = roundLedgerMoney(invoices.reduce((s, i) => s + i.grandTotal.toNumber(), 0));
    const totalPaid = roundLedgerMoney(invoices.reduce((s, i) => s + i.amountPaid.toNumber(), 0));
    const rawEntries: Array<{
      id: string;
      invoiceNumber: string;
      date: Date;
      type: "invoice" | "payment";
      amount: number;
      sortOrder: number;
    }> = [];

    for (const invoice of invoices) {
      rawEntries.push({
        id: `invoice-${invoice.id}`,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        type: "invoice",
        amount: invoice.grandTotal.toNumber(),
        sortOrder: 0,
      });

      for (const payment of invoice.payments) {
        rawEntries.push({
          id: `payment-${payment.id}`,
          invoiceNumber: invoice.invoiceNumber,
          date: payment.paidAt,
          type: "payment",
          amount: payment.amount.toNumber(),
          sortOrder: 1,
        });
      }
    }

    rawEntries.sort((left, right) => {
      const byDate = left.date.getTime() - right.date.getTime();
      if (byDate !== 0) {
        return byDate;
      }

      const bySortOrder = left.sortOrder - right.sortOrder;
      if (bySortOrder !== 0) {
        return bySortOrder;
      }

      return left.id.localeCompare(right.id);
    });

    let balance = 0;
    const entries = rawEntries.map((entry) => {
      balance = roundLedgerMoney(entry.type === "invoice" ? balance + entry.amount : balance - entry.amount);
      return {
        id: entry.id,
        invoiceNumber: entry.invoiceNumber,
        date: entry.date.toISOString(),
        type: entry.type,
        amount: roundLedgerMoney(entry.amount),
        balance,
      };
    }).reverse();
    const filteredEntries = entries.filter((entry) => {
      const time = Date.parse(entry.date);
      if (query.from && time < query.from.getTime()) return false;
      if (query.to && time > query.to.getTime()) return false;
      return true;
    });
    const total = filteredEntries.length;
    const pagedEntries = filteredEntries.slice((query.page - 1) * query.limit, query.page * query.limit);
    const outstanding = roundLedgerMoney(totalBilled - totalPaid);

    return { customer, totalBilled, totalPaid, outstanding, outstandingDue: outstanding, entries: pagedEntries, page: query.page, limit: query.limit, total };
  });

  done();
};

function roundLedgerMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function handleBilling<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof BillingError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}
