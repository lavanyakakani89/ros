import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { InvoiceStatus } from "@prisma/client";
import { z } from "zod";

import {
  createCustomerSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from "./customers.schema.js";
import { CustomersError, CustomersService } from "./customers.service.js";
import { generateCustomerStatementPdf, type CustomerStatementData } from "./customer-statement.pdf.js";
import { importCustomers, sendCustomerExport, sendCustomerTemplate } from "../import-export/customer-import-export.js";

export const customersRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new CustomersService(fastify);
  const statementQuerySchema = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  });

  fastify.get("/api/customers", async (request, reply) => {
    const query = customerListQuerySchema.parse(request.query);
    return handleCustomers(reply, () => service.listCustomers(request.tenant, query, request.user?.role));
  });

  fastify.get("/api/customers/template", async (_request, reply) => {
    return sendCustomerTemplate(reply);
  });

  fastify.get("/api/customers/export", async (request, reply) => {
    return sendCustomerExport(fastify, request.tenant, reply);
  });

  fastify.post("/api/customers/import", async (request, reply) => {
    return handleCustomers(reply, async () => {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "Upload an Excel file." });
      }

      const buffer = await file.toBuffer();
      return importCustomers(fastify, request.tenant, buffer);
    });
  });

  fastify.get("/api/customers/outstanding", async (request, reply) => {
    return handleCustomers(reply, async () => {
      if (request.user.role === "STAFF" || request.user.role === "DELIVERY") {
        return reply.status(403).send({ error: "Insufficient permissions" });
      }

      const query = z.object({
        minDue: z.coerce.number().nonnegative().default(1),
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(25),
        sortBy: z.enum(["amount_due", "last_invoice_date", "name"]).default("amount_due"),
      }).parse(request.query);

      const customers = await fastify.prisma.customer.findMany({
        where: {
          tenantId: request.tenant.id,
          invoices: {
            some: {
              tenantId: request.tenant.id,
              status: { not: InvoiceStatus.CANCELLED },
              amountDue: { gt: 0 },
            },
          },
        },
        include: {
          invoices: {
            where: {
              tenantId: request.tenant.id,
              status: { not: InvoiceStatus.CANCELLED },
              amountDue: { gt: 0 },
            },
            select: {
              amountDue: true,
              invoiceDate: true,
              invoiceNumber: true,
            },
          },
        },
      });

      const debtors = customers
        .map((customer) => {
          const invoices = customer.invoices;
          const totalOutstanding = roundMoney(invoices.reduce((sum, invoice) => sum + invoice.amountDue.toNumber(), 0));
          const invoiceDates = invoices.map((invoice) => invoice.invoiceDate.getTime());

          return {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            totalOutstanding,
            invoiceCount: invoices.length,
            lastInvoiceDate: invoiceDates.length > 0 ? new Date(Math.max(...invoiceDates)).toISOString() : null,
            oldestUnpaidDate: invoiceDates.length > 0 ? new Date(Math.min(...invoiceDates)).toISOString() : null,
          };
        })
        .filter((customer) => customer.totalOutstanding >= query.minDue)
        .sort((left, right) => {
          if (query.sortBy === "name") {
            return left.name.localeCompare(right.name);
          }

          if (query.sortBy === "last_invoice_date") {
            return new Date(right.lastInvoiceDate ?? 0).getTime() - new Date(left.lastInvoiceDate ?? 0).getTime();
          }

          return right.totalOutstanding - left.totalOutstanding;
        });

      const start = (query.page - 1) * query.limit;
      return {
        data: debtors.slice(start, start + query.limit),
        page: query.page,
        limit: query.limit,
        total: debtors.length,
      };
    });
  });

  fastify.post("/api/customers", async (request, reply) => {
    const input = createCustomerSchema.parse(request.body);
    return handleCustomers(reply, () => service.createCustomer(request.tenant, input, request.user?.role));
  });

  fastify.post("/api/customers/:id/statement-pdf", async (request, reply) => {
    return handleCustomers(reply, async () => {
      const params = customerIdParamsSchema.parse(request.params);
      const query = statementQuerySchema.parse(request.query);
      const statement = await buildCustomerStatement(fastify, request.tenant.id, params.id, query);
      const pdfUrl = await generateCustomerStatementPdf({
        statement,
        tenant: request.tenant,
        minio: fastify.minio,
        bucket: fastify.minioBucket,
      });

      return {
        pdfUrl,
        downloadUrl: customerStatementPdfViewUrl(params.id, query),
      };
    });
  });

  fastify.get("/api/customers/:id/statement-pdf/view", async (request, reply) => {
    return handleCustomers(reply, async () => {
      const params = customerIdParamsSchema.parse(request.params);
      const query = statementQuerySchema.parse(request.query);
      const statement = await buildCustomerStatement(fastify, request.tenant.id, params.id, query);
      const pdfUrl = await generateCustomerStatementPdf({
        statement,
        tenant: request.tenant,
        minio: fastify.minio,
        bucket: fastify.minioBucket,
      });
      let stream;
      try {
        stream = await fastify.minio.getObject(fastify.minioBucket, pdfUrl);
      } catch (error) {
        fastify.log.error({ error, tenantId: request.tenant.id, customerId: params.id, objectName: pdfUrl }, "Generated customer statement PDF was unavailable");
        throw new CustomersError("Customer statement PDF could not be opened after generation.", 502);
      }

      reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${statement.customer.name}-statement.pdf"`)
        .header("Cache-Control", "no-store, max-age=0");
      return reply.send(stream);
    });
  });

  fastify.get("/api/customers/:id", async (request, reply) => {
    const params = customerIdParamsSchema.parse(request.params);
    return handleCustomers(reply, () => service.getCustomer(request.tenant, params.id, request.user?.role));
  });

  fastify.put("/api/customers/:id", async (request, reply) => {
    const params = customerIdParamsSchema.parse(request.params);
    const input = updateCustomerSchema.parse(request.body);
    return handleCustomers(reply, () => service.updateCustomer(request.tenant, params.id, input, request.user?.role));
  });

  done();
};

async function handleCustomers<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof CustomersError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function buildCustomerStatement(
  fastify: FastifyInstance,
  tenantId: string,
  customerId: string,
  query: { from?: Date | undefined; to?: Date | undefined },
): Promise<CustomerStatementData> {
  const customer = await fastify.prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });
  if (!customer) {
    throw new CustomersError("Customer not found", 404);
  }

  const invoices = await fastify.prisma.invoice.findMany({
    where: {
      tenantId,
      customerId,
      status: { not: InvoiceStatus.CANCELLED },
    },
    include: {
      payments: {
        orderBy: { paidAt: "asc" },
      },
    },
    orderBy: { invoiceDate: "asc" },
  });
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
  const allEntries = rawEntries.map((entry) => {
    balance = roundMoney(entry.type === "invoice" ? balance + entry.amount : balance - entry.amount);
    return {
      date: entry.date,
      invoiceNumber: entry.invoiceNumber,
      description: entry.type === "invoice" ? "Invoice" : "Payment received",
      debit: entry.type === "invoice" ? roundMoney(entry.amount) : 0,
      credit: entry.type === "payment" ? roundMoney(entry.amount) : 0,
      balance,
    };
  });
  const fromTime = query.from?.getTime();
  const toTime = query.to ? endOfDay(query.to).getTime() : undefined;
  const entries = allEntries.filter((entry) => {
    const time = entry.date.getTime();
    if (fromTime !== undefined && time < fromTime) return false;
    if (toTime !== undefined && time > toTime) return false;
    return true;
  });

  return {
    customer,
    entries,
    from: query.from,
    to: query.to,
    totalBilled: roundMoney(entries.reduce((sum, entry) => sum + entry.debit, 0)),
    totalPaid: roundMoney(entries.reduce((sum, entry) => sum + entry.credit, 0)),
    outstandingDue: roundMoney(balance),
  };
}

function endOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function customerStatementPdfViewUrl(customerId: string, query: { from?: Date | undefined; to?: Date | undefined }): string {
  const baseUrl = process.env.PUBLIC_APP_URL ?? (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "");
  const params = new URLSearchParams();
  if (query.from) {
    params.set("from", query.from.toISOString().slice(0, 10));
  }
  if (query.to) {
    params.set("to", query.to.toISOString().slice(0, 10));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${baseUrl}/api/customers/${customerId}/statement-pdf/view${suffix}`;
}
