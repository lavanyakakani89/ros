import type { FastifyPluginCallback, FastifyReply } from "fastify";

import { BillingError, BillingService } from "./billing.service.js";
import { createInvoiceSchema, invoiceIdParamsSchema, invoiceListQuerySchema, updateInvoiceSchema } from "./billing.schema.js";

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
