import type { Product, Tenant } from "@prisma/client";

import { generateGstInvoicePdf } from "./billing.pdf.js";
import { BillingRepository, type InvoiceTotals } from "./billing.repository.js";
import type { CreateInvoiceInput, InvoiceItemInput, InvoiceListQuery, UpdateInvoiceInput } from "./billing.types.js";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";

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
    const calculated = await this.calculateInvoice(tenant.id, input.items);

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
      items:
        input.items ??
        existing.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity.toNumber(),
          discount: item.discount.toNumber(),
          ...(item.batchNumber ? { batchNumber: item.batchNumber } : {}),
          ...(item.expiryDate ? { expiryDate: item.expiryDate } : {}),
        })),
      ...(input.customerId !== undefined ? { customerId: input.customerId } : existing.customerId ? { customerId: existing.customerId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : existing.dueDate ? { dueDate: existing.dueDate } : {}),
      ...(input.verticalData !== undefined
        ? { verticalData: input.verticalData }
        : existing.verticalData && typeof existing.verticalData === "object" && !Array.isArray(existing.verticalData)
          ? { verticalData: existing.verticalData }
          : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : existing.notes ? { notes: existing.notes } : {}),
    };

    const calculated = await this.calculateInvoice(tenant.id, merged.items);
    const invoice = await this.repository.replaceDraftInvoice({
      tenantId: tenant.id,
      invoiceId,
      invoice: merged,
      totals: calculated.totals,
      items: calculated.items,
    });

    if (!invoice) {
      throw new BillingError("Only draft invoices can be updated", 409);
    }

    return invoice;
  }

  async confirmInvoice(tenant: Tenant, invoiceId: string) {
    try {
      const invoice = await this.repository.confirmInvoice(tenant.id, invoiceId);
      if (!invoice) {
        throw new BillingError("Draft invoice not found", 404);
      }

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
    const objectName = await generateGstInvoicePdf({
      invoice,
      tenant,
      minio: this.fastify.minio,
      bucket: this.fastify.minioBucket,
    });

    await this.repository.updateInvoicePdfUrl(tenant.id, invoiceId, objectName);
    const downloadUrl = await this.fastify.minio.presignedGetObject(this.fastify.minioBucket, objectName, 60 * 10);

    return {
      objectName,
      downloadUrl,
    };
  }

  async getInvoicePdfUrl(tenant: Tenant, invoiceId: string) {
    const invoice = await this.getInvoice(tenant, invoiceId);
    if (!invoice.pdfUrl) {
      throw new BillingError("Invoice PDF has not been generated", 404);
    }

    return {
      objectName: invoice.pdfUrl,
      downloadUrl: await this.fastify.minio.presignedGetObject(this.fastify.minioBucket, invoice.pdfUrl, 60 * 10),
    };
  }

  private async calculateInvoice(tenantId: string, items: InvoiceItemInput[]) {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await this.repository.findProducts(tenantId, productIds);
    const productById = new Map(products.map((product) => [product.id, product]));

    if (products.length !== productIds.length) {
      throw new BillingError("One or more products were not found", 400);
    }

    const invoiceItems = items.map((item) => createInvoiceItem(tenantId, item, productById.get(item.productId)));
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

}

function createInvoiceItem(
  tenantId: string,
  input: InvoiceItemInput,
  product: Product | undefined,
): Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput {
  if (!product) {
    throw new BillingError("Product not found", 400);
  }

  const quantity = input.quantity;
  const sellingPrice = product.sellingPrice.toNumber();
  const taxable = Math.max(sellingPrice * quantity - (input.discount ?? 0), 0);
  const gstRate = product.gstRate.toNumber();
  const totalGst = taxable * (gstRate / 100);
  const cgst = roundMoney(totalGst / 2);
  const sgst = roundMoney(totalGst / 2);
  const total = roundMoney(taxable + cgst + sgst);

  return {
    tenantId,
    productId: input.productId,
    productName: product.name,
    quantity,
    unit: product.unit,
    mrp: product.mrp,
    sellingPrice: product.sellingPrice,
    discount: input.discount ?? 0,
    gstRate: product.gstRate,
    cgst,
    sgst,
    total,
    ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}),
    ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
  };
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
