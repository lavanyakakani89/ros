import type { InvoiceTemplate, Product, Tenant } from "@prisma/client";

import { generateGstInvoicePdf } from "./billing.pdf.js";
import { BillingRepository, type InvoiceTotals } from "./billing.repository.js";
import type { CreateInvoiceInput, InvoiceItemInput, InvoiceListQuery, UpdateInvoiceInput } from "./billing.types.js";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { getEffectiveTemplate, printInvoiceForTenant } from "../printer/printer.service.js";
import { queueWhatsappNotification } from "../whatsapp/whatsapp.notifications.js";

export class BillingError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class BillingService {
  private readonly repository: BillingRepository;
  private readonly fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.repository = new BillingRepository(fastify.prisma);
  }

  async createInvoice(tenant: Tenant, input: CreateInvoiceInput) {
    const calculated = await this.calculateInvoice(tenant, input.items, input.billDiscount);

    return this.repository.createInvoice({
      tenantId: tenant.id,
      datePart: getInvoiceDatePart(),
      invoice: input,
      totals: calculated.totals,
      items: calculated.items,
    });
  }

  listInvoices(tenant: Tenant, query: InvoiceListQuery) {
    return this.repository.listInvoices(tenant.id, query);
  }

  async getInvoice(tenant: Tenant, invoiceId: string) {
    const invoice = await this.repository.getInvoice(tenant.id, invoiceId);
    if (!invoice) {
      throw new BillingError("Invoice not found", 404);
    }

    return invoice;
  }

  async updateInvoice(tenant: Tenant, invoiceId: string, input: UpdateInvoiceInput) {
    const existing = await this.getInvoice(tenant, invoiceId);
    const merged: CreateInvoiceInput = {
      paymentMode: input.paymentMode ?? existing.paymentMode,
      billDiscount: input.billDiscount ?? 0,
      items:
        input.items ??
        existing.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity.toNumber(),
          sellingPrice: item.sellingPrice.toNumber(),
          discount: item.discount.toNumber(),
          ...(item.batchNumber ? { batchNumber: item.batchNumber } : {}),
          ...(item.expiryDate ? { expiryDate: item.expiryDate } : {}),
        })),
      ...(input.customerId !== undefined ? input.customerId ? { customerId: input.customerId } : {} : existing.customerId ? { customerId: existing.customerId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : existing.dueDate ? { dueDate: existing.dueDate } : {}),
      ...(input.verticalData !== undefined
        ? { verticalData: input.verticalData }
        : existing.verticalData && typeof existing.verticalData === "object" && !Array.isArray(existing.verticalData)
          ? { verticalData: existing.verticalData }
          : {}),
      ...(input.notes !== undefined ? input.notes ? { notes: input.notes } : {} : existing.notes ? { notes: existing.notes } : {}),
    };

    const calculated = await this.calculateInvoice(tenant, merged.items, merged.billDiscount);
    let invoice: Awaited<ReturnType<BillingRepository["replaceInvoice"]>>;
    try {
      invoice = await this.repository.replaceInvoice({
        tenantId: tenant.id,
        invoiceId,
        invoice: merged,
        totals: calculated.totals,
        items: calculated.items,
      });
    } catch (error) {
      if (error instanceof BillingError) {
        throw error;
      }

      throw new BillingError(error instanceof Error ? error.message : "Unable to update invoice", 409);
    }

    if (!invoice) {
      throw new BillingError("Invoice not found", 404);
    }

    return invoice;
  }

  async confirmInvoice(tenant: Tenant, invoiceId: string, confirmedBy = "system") {
    try {
      const invoice = await this.repository.confirmInvoice(tenant.id, invoiceId, confirmedBy);
      if (!invoice) {
        throw new BillingError("Draft invoice not found", 404);
      }

      await this.notifyWhatsappInvoiceConfirmed(tenant, invoice).catch((error: unknown) => {
        this.fastify.log.error({ error, invoiceId, tenantId: tenant.id }, "Failed to queue WhatsApp invoice confirmation");
      });

      return invoice;
    } catch (error) {
      if (error instanceof BillingError) {
        throw error;
      }

      throw new BillingError(error instanceof Error ? error.message : "Unable to confirm invoice", 409);
    }
  }

  async cancelInvoice(tenant: Tenant, invoiceId: string) {
    const invoice = await this.repository.cancelInvoice(tenant.id, invoiceId);
    if (!invoice) {
      throw new BillingError("Invoice not found or already cancelled", 404);
    }

    return invoice;
  }

  async generateInvoicePdf(tenant: Tenant, invoiceId: string) {
    const invoice = await this.getInvoice(tenant, invoiceId);
    const template = await getEffectiveTemplate(this.fastify, tenant);
    const objectName = await this.renderInvoicePdf({
      tenant,
      invoice,
      template,
      invoiceId,
    });

    await this.repository.updateInvoicePdfUrl(tenant.id, invoiceId, objectName);

    return {
      objectName,
      downloadUrl: invoicePdfViewUrl(invoiceId),
      templateId: template?.id ?? null,
      templateName: template?.name ?? "RetailOS default",
      renderType: template?.renderType ?? "HTML_PDF",
    };
  }

  async getInvoicePdfUrl(tenant: Tenant, invoiceId: string) {
    return this.generateInvoicePdf(tenant, invoiceId);
  }

  async printInvoice(tenant: Tenant, invoiceId: string) {
    const invoice = await this.getInvoice(tenant, invoiceId);
    return printInvoiceForTenant({
      fastify: this.fastify,
      tenant,
      invoice,
    });
  }

  private async renderInvoicePdf(input: {
    tenant: Tenant;
    invoice: Awaited<ReturnType<BillingService["getInvoice"]>>;
    template: InvoiceTemplate | null;
    invoiceId: string;
  }): Promise<string> {
    try {
      return await generateGstInvoicePdf({
        invoice: input.invoice,
        tenant: input.tenant,
        minio: this.fastify.minio,
        bucket: this.fastify.minioBucket,
        template: input.template,
      });
    } catch (error) {
      this.fastify.log.error(
        {
          error,
          invoiceId: input.invoiceId,
          tenantId: input.tenant.id,
          templateId: input.template?.id,
          templateName: input.template?.name,
        },
        "Invoice PDF generation failed",
      );
      throw new BillingError(`Selected invoice template failed: ${safeErrorMessage(error)}`, 502);
    }
  }

  private async calculateInvoice(tenant: Tenant, items: InvoiceItemInput[], billDiscount = 0) {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await this.repository.findProducts(tenant.id, productIds);
    const productById = new Map(products.map((product) => [product.id, product]));

    if (products.length !== productIds.length) {
      throw new BillingError("One or more products were not found", 400);
    }

    const lineTaxableBases = items.map((item) => getTaxableBaseBeforeBillDiscount(item, productById.get(item.productId)));
    const totalTaxableBase = lineTaxableBases.reduce((sum, value) => sum + value, 0);
    const cappedBillDiscount = Math.min(roundMoney(billDiscount), totalTaxableBase);
    const invoiceItems = items.map((item, index) => {
      const lineTaxableBase = lineTaxableBases[index] ?? 0;
      const billDiscountShare = totalTaxableBase > 0 ? roundMoney(cappedBillDiscount * (lineTaxableBase / totalTaxableBase)) : 0;
      return createInvoiceItem(tenant, item, productById.get(item.productId), billDiscountShare);
    });
    const totals = invoiceItems.reduce<InvoiceTotals>(
      (accumulator, item) => ({
        subtotal: roundMoney(accumulator.subtotal + Number(item.sellingPrice) * Number(item.quantity)),
        totalDiscount: roundMoney(accumulator.totalDiscount + Number(item.discount)),
        totalCgst: roundMoney(accumulator.totalCgst + Number(item.cgst)),
        totalSgst: roundMoney(accumulator.totalSgst + Number(item.sgst)),
        grandTotal: roundMoney(accumulator.grandTotal + Number(item.total)),
      }),
      {
        subtotal: 0,
        totalDiscount: 0,
        totalCgst: 0,
        totalSgst: 0,
        grandTotal: 0,
      },
    );

    return {
      totals,
      items: invoiceItems,
    };
  }

  private async notifyWhatsappInvoiceConfirmed(tenant: Tenant, invoice: Awaited<ReturnType<BillingRepository["confirmInvoice"]>>) {
    if (!invoice || !isWhatsappSourced(invoice.verticalData) || !invoice.customer?.phone) {
      return;
    }

    const metadata = toRecord(invoice.verticalData);
    const whatsappOrderId = typeof metadata.whatsappOrderId === "string" ? metadata.whatsappOrderId : null;
    const pdf = await this.generateInvoicePdf(tenant, invoice.id).catch((error: unknown) => {
      this.fastify.log.error({ error, invoiceId: invoice.id, tenantId: tenant.id }, "Failed to generate WhatsApp invoice PDF");
      return null;
    });
    const pdfLine = pdf?.downloadUrl ? `\nInvoice: ${pdf.downloadUrl}` : "";
    const message = [
      `Hi ${invoice.customer.name}, your order ${invoice.invoiceNumber} from ${tenant.name} is confirmed.`,
      `Total: ₹${invoice.grandTotal.toNumber().toFixed(2)}.`,
      pdfLine,
    ].join(" ").replace(/\s+\n/g, "\n").trim();

    if (whatsappOrderId) {
      await this.fastify.prisma.whatsappOrder.updateMany({
        where: {
          id: whatsappOrderId,
          tenantId: tenant.id,
        },
        data: {
          status: "CONFIRMED",
          invoiceId: invoice.id,
        },
      });
    }

    await queueWhatsappNotification(this.fastify, {
      tenantId: tenant.id,
      phone: invoice.customer.phone,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      message,
      jobName: "invoice-confirmed",
    });
  }

}

function invoicePdfViewUrl(invoiceId: string): string {
  const baseUrl = process.env.PUBLIC_APP_URL ?? (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : "");
  return `${baseUrl}/api/billing/invoices/${invoiceId}/pdf/view`;
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown PDF renderer error";
  }

  return error.message.replace(/\s+/g, " ").slice(0, 180) || "Unknown PDF renderer error";
}

function isWhatsappSourced(value: unknown): boolean {
  const record = toRecord(value);
  if (record.whatsappManual === true) {
    return false;
  }

  return record.source === "WHATSAPP" || typeof record.whatsappOrderId === "string";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function createInvoiceItem(
  tenant: Tenant,
  input: InvoiceItemInput,
  product: Product | undefined,
  billDiscountShare: number,
): Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput {
  if (!product) {
    throw new BillingError("Product not found", 400);
  }

  const quantity = input.quantity;
  const sellingPrice = input.sellingPrice ?? product.sellingPrice.toNumber();
  const gross = sellingPrice * quantity;
  const lineDiscount = input.discountPercent !== undefined ? roundMoney(gross * (input.discountPercent / 100)) : (input.discount ?? 0);
  const discount = roundMoney(lineDiscount + billDiscountShare);
  const taxable = Math.max(gross - discount, 0);
  const gstRate = tenant.gstEnabled ? product.gstRate.toNumber() : 0;
  const totalGst = tenant.gstEnabled ? taxable * (gstRate / 100) : 0;
  const cgst = roundMoney(totalGst / 2);
  const sgst = roundMoney(totalGst / 2);
  const total = roundMoney(taxable + cgst + sgst);

  return {
    tenantId: tenant.id,
    productId: input.productId,
    productName: product.name,
    quantity,
    unit: product.unit,
    mrp: product.mrp,
    sellingPrice,
    discount,
    gstRate,
    cgst,
    sgst,
    total,
    ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}),
    ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
  };
}

function getTaxableBaseBeforeBillDiscount(input: InvoiceItemInput, product: Product | undefined): number {
  if (!product) {
    throw new BillingError("Product not found", 400);
  }

  const sellingPrice = input.sellingPrice ?? product.sellingPrice.toNumber();
  const gross = sellingPrice * input.quantity;
  const lineDiscount = input.discountPercent !== undefined ? roundMoney(gross * (input.discountPercent / 100)) : (input.discount ?? 0);
  return Math.max(gross - lineDiscount, 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getInvoiceDatePart(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replaceAll("-", "");
}
