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
    return handleBilling(reply, () => service.updateInvoice(request.tenant, params.id, input));
  });

  fastify.post("/api/billing/invoices/:id/confirm", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.confirmInvoice(request.tenant, params.id));
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
      const pdf = invoice.pdfUrl
        ? { objectName: invoice.pdfUrl }
        : await service.generateInvoicePdf(request.tenant, params.id);

      const stream = await fastify.minio.getObject(fastify.minioBucket, pdf.objectName);
      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.pdf"`);
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

      await whatsappNotifyQueue.add("invoice-share", { phone: customer.phone, message });
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
      await whatsappNotifyQueue.add("invoice-share", { phone: customer.phone, message });
      return { status: "queued" };
    });
  });

  // Customer ledger — all invoices + payments for a customer
  fastify.get("/api/billing/customer-ledger/:customerId", async (request) => {
    const { customerId } = z.object({ customerId: z.string().min(1) }).parse(request.params);
    const invoices = await fastify.prisma.invoice.findMany({
      where: { tenantId: request.tenant.id, customerId, status: { not: "CANCELLED" } },
      include: { payments: true, items: { select: { productName: true, quantity: true, total: true } } },
      orderBy: { invoiceDate: "desc" },
    });
    const customer = await fastify.prisma.customer.findFirst({ where: { id: customerId, tenantId: request.tenant.id } });
    const totalBilled = invoices.reduce((s, i) => s + i.grandTotal.toNumber(), 0);
    const totalPaid = invoices.reduce((s, i) => s + i.amountPaid.toNumber(), 0);
    return { customer, invoices, totalBilled, totalPaid, outstandingDue: totalBilled - totalPaid };
  });

  done();
};

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
