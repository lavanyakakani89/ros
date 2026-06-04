import { z } from "zod";
import { CreditNoteStatus, InvoiceStatus, PaymentMode } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";

import { BillingError, BillingService } from "./billing.service.js";
import { createInvoiceSchema, invoiceIdParamsSchema, invoiceListQuerySchema, updateInvoiceSchema } from "./billing.schema.js";
import { whatsappNotifyQueue } from "../../jobs/whatsapp-notify.job.js";
import { moneyForWhatsapp, renderWhatsappMessageTemplate } from "../whatsapp/whatsapp.templates.js";

const customerLedgerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const billingRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new BillingService(fastify);
  const returnInvoiceSchema = z.object({
    reason: z.string().trim().min(1),
    customerName: z.string().trim().min(1).max(128).optional(),
    customerPhone: z.string().trim().min(5).max(20).optional(),
    items: z.array(z.object({
      productId: z.string().min(1),
      quantity: z.coerce.number().positive(),
    })).min(1),
  });
  const posConfirmSchema = z.object({
    invoice: createInvoiceSchema,
    payments: z.array(z.object({
      mode: z.nativeEnum(PaymentMode),
      amount: z.coerce.number().positive().optional(),
      paymentMethodId: z.string().trim().min(1).optional(),
      referenceNumber: z.string().trim().min(1).optional(),
    })).optional(),
    delivery: z.object({
      customerId: z.string().min(1),
      deliveryAddress: z.string().trim().min(5),
      scheduledAt: z.coerce.date().optional(),
      notes: z.string().trim().min(1).optional(),
    }).optional(),
  });

  fastify.post("/api/billing/invoices", async (request, reply) => {
    const input = createInvoiceSchema.parse(request.body);
    return handleBilling(reply, () => service.createInvoice(request.tenant, {
      ...input,
      ...storeIdForWrite(request.user.role, request.storeId, input.storeId),
    }));
  });

  fastify.post("/api/billing/invoices/pos-confirm", async (request, reply) => {
    const input = posConfirmSchema.parse(request.body);
    return handleBilling(reply, () => service.createConfirmedPosInvoice(request.tenant, {
      invoice: {
        ...input.invoice,
        ...storeIdForWrite(request.user.role, request.storeId, input.invoice.storeId),
      },
      ...(input.payments ? { payments: input.payments } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
    }, request.user.userId));
  });

  fastify.get("/api/billing/invoices", async (request, reply) => {
    const query = invoiceListQuerySchema.parse(request.query);
    return handleBilling(reply, () => Promise.resolve(service.listInvoices(request.tenant, {
      ...query,
      ...storeIdForRead(request.user.role, request.storeId, query.storeId),
    })));
  });

  fastify.get("/api/billing/invoices/:id", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.getInvoice(request.tenant, params.id));
  });

  fastify.put("/api/billing/invoices/:id", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    const input = updateInvoiceSchema.parse(request.body);
    return handleBilling(reply, () => service.updateInvoice(request.tenant, params.id, {
      ...input,
      ...storeIdForWrite(request.user.role, request.storeId, input.storeId),
    }, request.user.userId));
  });

  fastify.post("/api/billing/invoices/:id/confirm", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.confirmInvoice(request.tenant, params.id, request.user.userId));
  });

  fastify.post("/api/billing/invoices/:id/cancel", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, () => service.cancelInvoice(request.tenant, params.id));
  });

  fastify.post("/api/billing/invoices/:id/return", async (request, reply) => {
    const params = invoiceIdParamsSchema.parse(request.params);
    return handleBilling(reply, async () => {
      const input = returnInvoiceSchema.parse(request.body);
      const invoice = await service.getInvoice(request.tenant, params.id);
      if (invoice.status !== InvoiceStatus.PAID) {
        throw new BillingError("Only paid invoices can be returned", 409);
      }

      const customerName = input.customerName?.trim();
      const customerPhone = normalizeCustomerPhone(input.customerPhone);
      if (!invoice.customer?.name.trim() && !customerName) {
        throw new BillingError("Customer name is required for returns", 400);
      }
      if (!invoice.customer?.phone.trim() && !customerPhone) {
        throw new BillingError("Customer mobile number is required for returns", 400);
      }

      const requestedByProduct = new Map<string, number>();
      for (const item of input.items) {
        requestedByProduct.set(item.productId, roundReturnQuantity((requestedByProduct.get(item.productId) ?? 0) + item.quantity));
      }

      const invoiceItemsByProduct = new Map(invoice.items.map((item) => [item.productId, item]));
      for (const productId of requestedByProduct.keys()) {
        if (!invoiceItemsByProduct.has(productId)) {
          throw new BillingError("Return item does not belong to this invoice", 400);
        }
      }

      const existingReturned = await fastify.prisma.creditNoteItem.groupBy({
        by: ["productId"],
        where: {
          tenantId: request.tenant.id,
          productId: { in: [...requestedByProduct.keys()] },
          creditNote: {
            tenantId: request.tenant.id,
            originalInvoiceId: invoice.id,
            status: { not: "CANCELLED" },
          },
        },
        _sum: {
          quantity: true,
        },
      });
      const returnedByProduct = new Map(existingReturned.map((item) => [item.productId, item._sum.quantity?.toNumber() ?? 0]));

      const creditNoteItems = [...requestedByProduct.entries()].map(([productId, quantity]) => {
        const invoiceItem = invoiceItemsByProduct.get(productId);
        if (!invoiceItem) {
          throw new BillingError("Return item does not belong to this invoice", 400);
        }
        const invoiceQuantity = invoiceItem.quantity.toNumber();
        const returnedQuantity = returnedByProduct.get(productId) ?? 0;
        if (quantity > invoiceQuantity - returnedQuantity + 0.0005) {
          throw new BillingError(`${invoiceItem.productName} return quantity exceeds sold quantity`, 400);
        }

        const unitDiscount = invoiceQuantity > 0 ? invoiceItem.discount.toNumber() / invoiceQuantity : 0;
        const discount = roundMoney(unitDiscount * quantity);
        const taxable = Math.max(invoiceItem.sellingPrice.toNumber() * quantity - discount, 0);
        const gstRate = invoiceItem.gstRate.toNumber();
        const cgst = roundMoney(taxable * gstRate / 200);
        const sgst = cgst;
        const total = roundMoney(taxable + cgst + sgst);

        return {
          tenantId: request.tenant.id,
          productId,
          productName: invoiceItem.productName,
          quantity,
          unit: invoiceItem.unit,
          sellingPrice: invoiceItem.sellingPrice,
          discount,
          gstRate: invoiceItem.gstRate,
          cgst,
          sgst,
          total,
        };
      });
      const subtotal = roundMoney(creditNoteItems.reduce((sum, item) => sum + item.sellingPrice.toNumber() * item.quantity, 0));
      const totalDiscount = roundMoney(creditNoteItems.reduce((sum, item) => sum + item.discount, 0));
      const totalCgst = roundMoney(creditNoteItems.reduce((sum, item) => sum + item.cgst, 0));
      const totalSgst = roundMoney(creditNoteItems.reduce((sum, item) => sum + item.sgst, 0));
      const grandTotal = roundMoney(creditNoteItems.reduce((sum, item) => sum + item.total, 0));
      const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");

      const creditNote = await fastify.prisma.$transaction(async (tx) => {
        let customerId = invoice.customerId ?? null;
        if (customerName || customerPhone) {
          const existingByPhone = customerPhone
            ? await tx.customer.findUnique({
                where: {
                  tenantId_phone: {
                    tenantId: request.tenant.id,
                    phone: customerPhone,
                  },
                },
              })
            : null;

          if (existingByPhone) {
            customerId = existingByPhone.id;
            if (customerName && !existingByPhone.name.trim()) {
              await tx.customer.update({
                where: { id: existingByPhone.id },
                data: { name: customerName },
              });
            }
          } else if (customerId) {
            const currentCustomer = await tx.customer.findFirst({
              where: {
                id: customerId,
                tenantId: request.tenant.id,
              },
            });
            if (currentCustomer) {
              await tx.customer.update({
                where: { id: currentCustomer.id },
                data: {
                  ...(customerName && !currentCustomer.name.trim() ? { name: customerName } : {}),
                  ...(customerPhone && !currentCustomer.phone.trim() ? { phone: customerPhone } : {}),
                },
              });
            } else {
              customerId = null;
            }
          }

          if (!customerId && customerName && customerPhone) {
            const createdCustomer = await tx.customer.create({
              data: {
                tenantId: request.tenant.id,
                name: customerName,
                phone: customerPhone,
              },
            });
            customerId = createdCustomer.id;
          }

          if (customerId && customerId !== invoice.customerId) {
            await tx.invoice.update({
              where: { id: invoice.id },
              data: { customerId },
            });
          }
        }

        const counter = await tx.invoiceCounter.upsert({
          where: { tenantId_date: { tenantId: request.tenant.id, date: `CN-${datePart}` } },
          create: { tenantId: request.tenant.id, date: `CN-${datePart}`, nextSeq: 2 },
          update: { nextSeq: { increment: 1 } },
        });

        const note = await tx.creditNote.create({
          data: {
            tenantId: request.tenant.id,
            creditNoteNumber: `CN-${datePart}-${String(counter.nextSeq - 1).padStart(4, "0")}`,
            originalInvoiceId: invoice.id,
            ...(customerId ? { customerId } : {}),
            status: CreditNoteStatus.CONFIRMED,
            reason: input.reason,
            subtotal,
            totalDiscount,
            totalCgst,
            totalSgst,
            grandTotal,
            items: { create: creditNoteItems },
          },
          include: { items: true, customer: true, originalInvoice: true },
        });

        for (const item of creditNoteItems) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: {
                increment: item.quantity,
              },
            },
          });
        }

        return note;
      });

      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "INVOICE_RETURN_CREATED",
          entity: "CREDIT_NOTE",
          entityId: creditNote.id,
          changes: {
            invoiceId: invoice.id,
            items: input.items,
            reason: input.reason,
            ...(customerName ? { customerName } : {}),
            ...(customerPhone ? { customerPhone } : {}),
          },
          ip: request.ip,
        },
      });

      return creditNote;
    });
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
      const message = await renderWhatsappMessageTemplate(fastify, request.tenant.id, "invoiceReady", {
        customerName: customer.name,
        tenantName: request.tenant.name,
        invoiceNumber: invoice.invoiceNumber,
        grandTotal: moneyForWhatsapp(invoice.grandTotal),
        paymentMode: invoice.paymentMode,
        itemsBlock: formatInvoiceItemsForWhatsapp(invoice.items),
        pdfLine: `Download: ${pdf.downloadUrl}`,
      });

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
      const message = await renderWhatsappMessageTemplate(fastify, request.tenant.id, "invoiceReady", {
        customerName: customer.name,
        tenantName: request.tenant.name,
        invoiceNumber: "invoice",
        grandTotal: moneyForWhatsapp(0),
        paymentMode: "-",
        itemsBlock: "",
        pdfLine: `Download: ${pdfUrl}`,
      });
      await whatsappNotifyQueue.add("invoice-share", { tenantId: request.tenant.id, phone: customer.phone, message });
      return { status: "queued" };
    });
  });

  // Customer ledger — all invoices + payments for a customer
  fastify.get("/api/billing/customer-ledger/:customerId", async (request) => {
    const { customerId } = z.object({ customerId: z.string().min(1) }).parse(request.params);
    const query = customerLedgerQuerySchema.parse(request.query);
    return buildCustomerLedger(fastify, request.tenant.id, customerId, query);
  });

  fastify.get("/api/customers/:id/ledger", async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const query = customerLedgerQuerySchema.parse(request.query);
    return buildCustomerLedger(fastify, request.tenant.id, id, query);
  });

  done();
};

async function buildCustomerLedger(
  fastify: FastifyInstance,
  tenantId: string,
  customerId: string,
  query: z.infer<typeof customerLedgerQuerySchema>,
) {
  const customer = await fastify.prisma.customer.findFirst({ where: { id: customerId, tenantId } });
  if (!customer) {
    throw new BillingError("Customer not found", 404);
  }

  const invoices = await fastify.prisma.invoice.findMany({
    where: { tenantId, customerId, status: { not: "CANCELLED" } },
    include: {
      payments: { orderBy: { recordedAt: "asc" } },
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
        date: payment.recordedAt,
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
}

function roundLedgerMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundReturnQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function normalizeCustomerPhone(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/[^\d+]/g, "");
}

function formatInvoiceItemsForWhatsapp(items: Array<{ productName: string; quantity: { toNumber(): number }; total: { toNumber(): number } }>): string {
  if (items.length === 0) {
    return "";
  }

  return [
    "Items:",
    ...items.slice(0, 8).map((item) => `- ${item.productName} x ${formatQuantityForWhatsapp(item.quantity.toNumber())} = ₹${moneyForWhatsapp(item.total)}`),
  ].join("\n");
}

function formatQuantityForWhatsapp(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
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

function storeIdForRead(role: string, sessionStoreId: string | null | undefined, requestedStoreId: string | undefined): { storeId?: string } {
  if (role === "OWNER" || role === "MANAGER") {
    return requestedStoreId ? { storeId: requestedStoreId } : sessionStoreId ? { storeId: sessionStoreId } : {};
  }

  return sessionStoreId ? { storeId: sessionStoreId } : requestedStoreId ? { storeId: requestedStoreId } : {};
}

function storeIdForWrite(role: string, sessionStoreId: string | null | undefined, requestedStoreId: string | undefined): { storeId?: string } {
  if (role === "OWNER" || role === "MANAGER") {
    return requestedStoreId ? { storeId: requestedStoreId } : sessionStoreId ? { storeId: sessionStoreId } : {};
  }

  return sessionStoreId ? { storeId: sessionStoreId } : {};
}
