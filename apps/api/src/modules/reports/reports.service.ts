import { InvoiceStatus, type PrismaClient, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import type { ReportDateRange } from "./reports.schema.js";

const activeInvoiceStatuses = [InvoiceStatus.CONFIRMED, InvoiceStatus.PAID, InvoiceStatus.PARTIAL];

export class ReportsService {
  private readonly prisma: PrismaClient;

  constructor(fastify: FastifyInstance) {
    this.prisma = fastify.prisma;
  }

  async getSalesSummary(tenant: Tenant, query: ReportDateRange) {
    const range = toRange(query);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        status: {
          in: activeInvoiceStatuses,
        },
        invoiceDate: range,
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: {
        invoiceDate: "asc",
      },
    });

    const grossSales = invoices.reduce((total, invoice) => total + invoice.subtotal.toNumber(), 0);
    const discountTotal = invoices.reduce((total, invoice) => total + invoice.totalDiscount.toNumber(), 0);
    const netSales = invoices.reduce((total, invoice) => total + invoice.grandTotal.toNumber(), 0);
    const totalCgst = invoices.reduce((total, invoice) => total + invoice.totalCgst.toNumber(), 0);
    const totalSgst = invoices.reduce((total, invoice) => total + invoice.totalSgst.toNumber(), 0);
    const paid = invoices.reduce((total, invoice) => total + invoice.amountPaid.toNumber(), 0);
    const due = invoices.reduce((total, invoice) => total + invoice.amountDue.toNumber(), 0);

    return {
      from: range.gte,
      to: range.lte,
      grossSales,
      discountTotal,
      netSales,
      totalGst: totalCgst + totalSgst,
      totalCgst,
      totalSgst,
      invoiceCount: invoices.length,
      averageBillValue: invoices.length > 0 ? netSales / invoices.length : 0,
      paid,
      due,
      dailySales: groupDailySales(invoices),
      gstByRate: groupGstByRate(invoices.flatMap((invoice) => invoice.items)),
      hsnSummary: groupHsn(invoices.flatMap((invoice) => invoice.items)),
      movingItems: groupMovingItems(invoices.flatMap((invoice) => invoice.items)),
    };
  }

  async getInventorySummary(tenant: Tenant) {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
      },
    });

    return {
      stockValue: products.reduce((total, product) => total + product.currentStock.toNumber() * (product.purchasePrice?.toNumber() ?? 0), 0),
      lowStockCount: products.filter((product) => product.reorderLevel !== null && product.currentStock.lte(product.reorderLevel)).length,
      stockByCategory: groupStockByCategory(products),
    };
  }
}

type InvoiceWithItems = Awaited<ReturnType<PrismaClient["invoice"]["findMany"]>>[number] & {
  items: Array<{
    productName: string;
    quantity: { toNumber: () => number };
    total: { toNumber: () => number };
    gstRate: { toNumber: () => number };
    cgst: { toNumber: () => number };
    sgst: { toNumber: () => number };
    product: {
      hsnCode: string | null;
      verticalData: unknown;
    };
  }>;
};

type InvoiceItemForReport = InvoiceWithItems["items"][number];

function toRange(query: ReportDateRange): { gte: Date; lte: Date } {
  const now = new Date();
  const from = query.from ?? new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const to = query.to ?? now;
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { gte: from, lte: to };
}

function groupDailySales(invoices: InvoiceWithItems[]) {
  const daily = new Map<string, { date: string; sales: number; invoices: number }>();

  for (const invoice of invoices) {
    const date = invoice.invoiceDate.toISOString().slice(0, 10);
    const current = daily.get(date) ?? { date, sales: 0, invoices: 0 };
    current.sales += invoice.grandTotal.toNumber();
    current.invoices += 1;
    daily.set(date, current);
  }

  return [...daily.values()];
}

function groupGstByRate(items: InvoiceItemForReport[]) {
  const grouped = new Map<string, { gstRate: number; taxableValue: number; cgst: number; sgst: number; totalGst: number }>();

  for (const item of items) {
    const rate = item.gstRate.toNumber();
    const key = String(rate);
    const current = grouped.get(key) ?? { gstRate: rate, taxableValue: 0, cgst: 0, sgst: 0, totalGst: 0 };
    current.taxableValue += item.total.toNumber() - item.cgst.toNumber() - item.sgst.toNumber();
    current.cgst += item.cgst.toNumber();
    current.sgst += item.sgst.toNumber();
    current.totalGst += item.cgst.toNumber() + item.sgst.toNumber();
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => left.gstRate - right.gstRate);
}

function groupHsn(items: InvoiceItemForReport[]) {
  const grouped = new Map<string, { hsnCode: string; taxableValue: number; totalGst: number; totalSales: number }>();

  for (const item of items) {
    const hsnCode = item.product.hsnCode ?? "Unspecified";
    const current = grouped.get(hsnCode) ?? { hsnCode, taxableValue: 0, totalGst: 0, totalSales: 0 };
    current.taxableValue += item.total.toNumber() - item.cgst.toNumber() - item.sgst.toNumber();
    current.totalGst += item.cgst.toNumber() + item.sgst.toNumber();
    current.totalSales += item.total.toNumber();
    grouped.set(hsnCode, current);
  }

  return [...grouped.values()].sort((left, right) => right.totalSales - left.totalSales);
}

function groupMovingItems(items: InvoiceItemForReport[]) {
  const grouped = new Map<string, { productName: string; quantitySold: number; totalSales: number }>();

  for (const item of items) {
    const current = grouped.get(item.productName) ?? { productName: item.productName, quantitySold: 0, totalSales: 0 };
    current.quantitySold += item.quantity.toNumber();
    current.totalSales += item.total.toNumber();
    grouped.set(item.productName, current);
  }

  return [...grouped.values()].sort((left, right) => right.quantitySold - left.quantitySold).slice(0, 20);
}

function groupStockByCategory(products: Array<{ name: string; currentStock: { toNumber: () => number }; verticalData: unknown }>) {
  const grouped = new Map<string, { category: string; products: number; stock: number }>();

  for (const product of products) {
    const category = readCategory(product.verticalData);
    const current = grouped.get(category) ?? { category, products: 0, stock: 0 };
    current.products += 1;
    current.stock += product.currentStock.toNumber();
    grouped.set(category, current);
  }

  return [...grouped.values()].sort((left, right) => right.stock - left.stock);
}

function readCategory(verticalData: unknown): string {
  if (typeof verticalData !== "object" || verticalData === null || !("category" in verticalData)) {
    return "Uncategorised";
  }

  const category = verticalData.category;
  return typeof category === "string" && category.trim() !== "" ? category : "Uncategorised";
}
