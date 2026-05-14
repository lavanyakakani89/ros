import { CreditNoteStatus, InvoiceStatus, PaymentMode, POStatus, type PrismaClient, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import type {
  ComparisonReportQuery,
  CustomerSalesReportQuery,
  OutstandingSummaryQuery,
  ReportDateRange,
  SparklineReportQuery,
  StockMovementReportQuery,
  SupplierPurchasesReportQuery,
  TallyExportQuery,
} from "./reports.schema.js";

const activeInvoiceStatuses = [InvoiceStatus.CONFIRMED, InvoiceStatus.PAID, InvoiceStatus.PARTIAL];

export class ReportsService {
  private readonly prisma: PrismaClient;

  constructor(fastify: FastifyInstance) {
    this.prisma = fastify.prisma;
  }

  async getSalesSummary(tenant: Tenant, query: ReportDateRange) {
    const range = toRange(query);
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId: tenant.id, status: { in: activeInvoiceStatuses }, invoiceDate: range, ...storeWhere(query.storeId) },
      include: { items: { include: { product: true } } },
      orderBy: { invoiceDate: "asc" },
    });

    const grossSales = invoices.reduce((t, i) => t + i.subtotal.toNumber(), 0);
    const discountTotal = invoices.reduce((t, i) => t + i.totalDiscount.toNumber(), 0);
    const netSales = invoices.reduce((t, i) => t + i.grandTotal.toNumber(), 0);
    const totalCgst = invoices.reduce((t, i) => t + i.totalCgst.toNumber(), 0);
    const totalSgst = invoices.reduce((t, i) => t + i.totalSgst.toNumber(), 0);
    const paid = invoices.reduce((t, i) => t + i.amountPaid.toNumber(), 0);
    const due = invoices.reduce((t, i) => t + i.amountDue.toNumber(), 0);

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
      gstByRate: groupGstByRate(invoices.flatMap((i) => i.items)),
      hsnSummary: groupHsn(invoices.flatMap((i) => i.items)),
      movingItems: groupMovingItems(invoices.flatMap((i) => i.items)),
    };
  }

  async getInventorySummary(tenant: Tenant) {
    const products = await this.prisma.product.findMany({ where: { tenantId: tenant.id, isActive: true } });
    return {
      stockValue: products.reduce((t, p) => t + p.currentStock.toNumber() * (p.purchasePrice?.toNumber() ?? 0), 0),
      lowStockCount: products.filter((p) => p.reorderLevel !== null && p.currentStock.lte(p.reorderLevel)).length,
      stockByCategory: groupStockByCategory(products),
    };
  }

  async getPnlReport(tenant: Tenant, query: ReportDateRange) {
    const range = toRange(query);
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId: tenant.id, status: { in: activeInvoiceStatuses }, invoiceDate: range, ...storeWhere(query.storeId) },
      include: { items: { include: { product: true } } },
    });

    const allItems = invoices.flatMap((i) => i.items);
    const productMap = new Map<string, { productName: string; quantitySold: number; revenue: number; cost: number }>();

    for (const item of allItems) {
      const name = item.productName;
      const qty = item.quantity.toNumber();
      const revenue = item.total.toNumber();
      const purchasePrice = item.product.purchasePrice?.toNumber() ?? 0;
      const cost = qty * purchasePrice;
      const existing = productMap.get(name) ?? { productName: name, quantitySold: 0, revenue: 0, cost: 0 };
      existing.quantitySold += qty;
      existing.revenue += revenue;
      existing.cost += cost;
      productMap.set(name, existing);
    }

    const items = [...productMap.values()].map((p) => ({
      ...p,
      profit: p.revenue - p.cost,
      marginPct: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
    })).sort((a, b) => b.profit - a.profit);

    const revenue = items.reduce((t, i) => t + i.revenue, 0);
    const cost = items.reduce((t, i) => t + i.cost, 0);
    const grossProfit = revenue - cost;

    return { revenue, cost, grossProfit, grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0, items };
  }

  async getDayEndReport(tenant: Tenant, date: string) {
    const dayStart = new Date(`${date}T00:00:00.000+05:30`);
    const dayEnd = new Date(`${date}T23:59:59.999+05:30`);

    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId: tenant.id, status: { in: activeInvoiceStatuses }, invoiceDate: { gte: dayStart, lte: dayEnd } },
      include: { payments: true },
    });

    const payments = invoices.flatMap((i) => i.payments);
    const byMode = (mode: PaymentMode) => payments.filter((p) => p.mode === mode).reduce((t, p) => t + p.amount.toNumber(), 0);

    const salesCash = byMode(PaymentMode.CASH);
    const salesUpi = byMode(PaymentMode.UPI);
    const salesCard = byMode(PaymentMode.CARD);
    const salesCredit = byMode(PaymentMode.CREDIT);
    const salesNetbanking = byMode(PaymentMode.NETBANKING);
    const totalCollection = salesCash + salesUpi + salesCard + salesCredit + salesNetbanking;

    const cancelledInvoices = await this.prisma.invoice.findMany({
      where: { tenantId: tenant.id, status: InvoiceStatus.CANCELLED, updatedAt: { gte: dayStart, lte: dayEnd } },
    });
    const refunds = cancelledInvoices.reduce((t, i) => t + i.amountPaid.toNumber(), 0);

    return {
      date,
      salesCash,
      salesUpi,
      salesCard,
      salesCredit,
      salesNetbanking,
      totalCollection,
      invoiceCount: invoices.length,
      refunds,
      closingCash: salesCash - refunds,
      openingCash: 0,
    };
  }

  async getCustomerSalesReport(tenant: Tenant, query: CustomerSalesReportQuery) {
    const range = toRange(query);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: activeInvoiceStatuses },
        invoiceDate: range,
        ...storeWhere(query.storeId),
        customerId: { not: null },
      },
      include: { customer: true },
    });

    const grouped = new Map<string, {
      id: string;
      name: string;
      phone: string;
      invoiceCount: number;
      totalRevenue: number;
      totalPaid: number;
      outstanding: number;
      lastPurchaseDate: Date | null;
      invoices: Array<{
        id: string;
        invoiceNumber: string;
        invoiceDate: Date;
        status: string;
        grandTotal: number;
        amountPaid: number;
        amountDue: number;
      }>;
    }>();

    for (const invoice of invoices) {
      if (!invoice.customer) continue;
      const current = grouped.get(invoice.customer.id) ?? {
        id: invoice.customer.id,
        name: invoice.customer.name,
        phone: invoice.customer.phone,
        invoiceCount: 0,
        totalRevenue: 0,
        totalPaid: 0,
        outstanding: 0,
        lastPurchaseDate: null,
        invoices: [],
      };
      current.invoiceCount += 1;
      current.totalRevenue += invoice.grandTotal.toNumber();
      current.totalPaid += invoice.amountPaid.toNumber();
      current.outstanding += invoice.amountDue.toNumber();
      current.lastPurchaseDate = !current.lastPurchaseDate || invoice.invoiceDate > current.lastPurchaseDate ? invoice.invoiceDate : current.lastPurchaseDate;
      current.invoices.push({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        status: invoice.status,
        grandTotal: invoice.grandTotal.toNumber(),
        amountPaid: invoice.amountPaid.toNumber(),
        amountDue: invoice.amountDue.toNumber(),
      });
      grouped.set(invoice.customer.id, current);
    }

    const sorted = [...grouped.values()].sort((left, right) => {
      if (query.sortBy === "invoices") return right.invoiceCount - left.invoiceCount;
      if (query.sortBy === "outstanding") return right.outstanding - left.outstanding;
      return right.totalRevenue - left.totalRevenue;
    });

    return paginate(sorted.map((row) => ({
      ...row,
      totalRevenue: roundNumber(row.totalRevenue),
      totalPaid: roundNumber(row.totalPaid),
      outstanding: roundNumber(row.outstanding),
      lastPurchaseDate: row.lastPurchaseDate?.toISOString() ?? null,
      invoices: row.invoices
        .sort((left, right) => right.invoiceDate.getTime() - left.invoiceDate.getTime())
        .map((invoice) => ({
          ...invoice,
          invoiceDate: invoice.invoiceDate.toISOString(),
          grandTotal: roundNumber(invoice.grandTotal),
          amountPaid: roundNumber(invoice.amountPaid),
          amountDue: roundNumber(invoice.amountDue),
        })),
    })), query.page, query.limit);
  }

  async getSupplierPurchasesReport(tenant: Tenant, query: SupplierPurchasesReportQuery) {
    const range = toRange(query);
    const suppliers = await this.prisma.supplier.findMany({
      where: { tenantId: tenant.id },
      include: {
        purchaseOrders: {
          where: {
            tenantId: tenant.id,
            status: { in: [POStatus.PARTIAL, POStatus.RECEIVED] },
            ...storeWhere(query.storeId),
            createdAt: range,
          },
        },
        supplierPayments: {
          where: {
            tenantId: tenant.id,
            paidAt: range,
          },
        },
      },
    });

    const rows = suppliers.map((supplier) => {
      const totalPurchased = supplier.purchaseOrders.reduce((sum, order) => sum + order.totalAmount.toNumber(), 0);
      const totalPaid = supplier.supplierPayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0);
      return {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        poCount: supplier.purchaseOrders.length,
        totalPurchased: roundNumber(totalPurchased),
        totalPaid: roundNumber(totalPaid),
        outstanding: roundNumber(Math.max(totalPurchased - totalPaid, 0)),
      };
    }).filter((row) => row.poCount > 0 || row.totalPaid > 0).sort((left, right) => right.totalPurchased - left.totalPurchased);

    return paginate(rows, query.page, query.limit);
  }

  async getOutstandingAgingReport(tenant: Tenant, query: { storeId?: string | undefined } = {}) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: activeInvoiceStatuses },
        amountDue: { gt: 0 },
        ...storeWhere(query.storeId),
        customerId: { not: null },
      },
      include: { customer: true },
      orderBy: { invoiceDate: "asc" },
    });

    const bucketData = new Map<AgingBucket, { bucket: AgingBucket; customerIds: Set<string>; totalOutstanding: number }>();
    for (const bucket of agingBuckets) {
      bucketData.set(bucket, { bucket, customerIds: new Set<string>(), totalOutstanding: 0 });
    }

    const customers = new Map<string, {
      id: string;
      name: string;
      phone: string;
      totalOutstanding: number;
      invoiceCount: number;
      oldestInvoiceDate: Date;
      bucket: AgingBucket;
    }>();

    const now = new Date();
    for (const invoice of invoices) {
      if (!invoice.customer) continue;
      const amountDue = invoice.amountDue.toNumber();
      const bucket = agingBucketFor(daysBetween(invoice.invoiceDate, now));
      const currentBucket = bucketData.get(bucket);
      if (currentBucket) {
        currentBucket.customerIds.add(invoice.customer.id);
        currentBucket.totalOutstanding += amountDue;
      }

      const current = customers.get(invoice.customer.id);
      if (!current) {
        customers.set(invoice.customer.id, {
          id: invoice.customer.id,
          name: invoice.customer.name,
          phone: invoice.customer.phone,
          totalOutstanding: amountDue,
          invoiceCount: 1,
          oldestInvoiceDate: invoice.invoiceDate,
          bucket,
        });
        continue;
      }

      current.totalOutstanding += amountDue;
      current.invoiceCount += 1;
      if (invoice.invoiceDate < current.oldestInvoiceDate) {
        current.oldestInvoiceDate = invoice.invoiceDate;
        current.bucket = bucket;
      }
    }

    return {
      buckets: agingBuckets.map((bucket) => {
        const data = bucketData.get(bucket);
        return {
          bucket,
          customerCount: data?.customerIds.size ?? 0,
          totalOutstanding: roundNumber(data?.totalOutstanding ?? 0),
        };
      }),
      customers: [...customers.values()]
        .map((customer) => ({
          ...customer,
          totalOutstanding: roundNumber(customer.totalOutstanding),
          oldestInvoiceDate: customer.oldestInvoiceDate.toISOString(),
        }))
        .sort((left, right) => right.totalOutstanding - left.totalOutstanding),
    };
  }

  async getStockMovementReport(tenant: Tenant, query: StockMovementReportQuery) {
    const range = query.from || query.to ? toRange(query) : null;
    const [adjustments, invoiceItems, purchaseItems, returnItems] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where: {
          tenantId: tenant.id,
          ...storeWhere(query.storeId),
          ...(query.productId ? { productId: query.productId } : {}),
          ...(range ? { createdAt: { lte: range.lte } } : {}),
        },
        include: { product: true },
      }),
      this.prisma.invoiceItem.findMany({
        where: {
          tenantId: tenant.id,
          ...(query.productId ? { productId: query.productId } : {}),
          invoice: {
            tenantId: tenant.id,
            status: { in: activeInvoiceStatuses },
            ...storeWhere(query.storeId),
            ...(range ? { invoiceDate: { lte: range.lte } } : {}),
          },
        },
        include: { invoice: true, product: true },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: {
          tenantId: tenant.id,
          ...(query.productId ? { productId: query.productId } : { productId: { not: null } }),
          purchaseOrder: {
            tenantId: tenant.id,
            status: { in: [POStatus.PARTIAL, POStatus.RECEIVED] },
            ...storeWhere(query.storeId),
          },
        },
        include: { purchaseOrder: true, product: true },
      }),
      this.prisma.creditNoteItem.findMany({
        where: {
          tenantId: tenant.id,
          ...(query.productId ? { productId: query.productId } : {}),
          creditNote: {
            tenantId: tenant.id,
            status: CreditNoteStatus.CONFIRMED,
            ...(query.storeId ? { originalInvoice: { tenantId: tenant.id, storeId: query.storeId } } : {}),
          },
        },
        include: { creditNote: true, product: true },
      }),
    ]);

    const events: StockMovementEvent[] = [
      ...adjustments.map((item) => ({
        productId: item.productId,
        productName: item.product.name,
        date: item.createdAt,
        type: "adjustment" as const,
        qty: item.quantityChange.toNumber(),
        reference: item.reason,
        notes: item.notes ?? "",
      })),
      ...invoiceItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        date: item.invoice.invoiceDate,
        type: "sale" as const,
        qty: -item.quantity.toNumber(),
        reference: item.invoice.invoiceNumber,
        notes: "",
      })),
      ...purchaseItems.flatMap((item): StockMovementEvent[] => {
        if (!item.productId || !item.product) return [];
        const receivedQuantity = item.receivedQuantity.toNumber() > 0 ? item.receivedQuantity.toNumber() : item.quantity.toNumber();
        return [{
          productId: item.productId,
          productName: item.product.name,
          date: item.purchaseOrder.receivedAt ?? item.purchaseOrder.createdAt,
          type: "purchase",
          qty: receivedQuantity,
          reference: item.purchaseOrder.poNumber,
          notes: "",
        }];
      }),
      ...returnItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        date: item.creditNote.createdAt,
        type: "return" as const,
        qty: item.quantity.toNumber(),
        reference: item.creditNote.creditNoteNumber,
        notes: item.creditNote.reason ?? "",
      })),
    ].sort((left, right) => left.date.getTime() - right.date.getTime());

    const runningBalanceByProduct = new Map<string, number>();
    const withBalance = events.map((event) => {
      const nextBalance = roundQuantity((runningBalanceByProduct.get(event.productId) ?? 0) + event.qty);
      runningBalanceByProduct.set(event.productId, nextBalance);
      return { ...event, runningBalance: nextBalance };
    });

    const filtered = withBalance
      .filter((event) => !range || (event.date >= range.gte && event.date <= range.lte))
      .filter((event) => !query.type || event.type === query.type)
      .sort((left, right) => right.date.getTime() - left.date.getTime())
      .map((event) => ({
        ...event,
        qty: roundQuantity(event.qty),
        date: event.date.toISOString(),
      }));

    return paginate(filtered, query.page, query.limit);
  }

  async getComparisonReport(tenant: Tenant, query: ComparisonReportQuery) {
    const [year1Data, year2Data] = await Promise.all([
      this.getMetricSeries(tenant.id, query.metric, query.period, query.year1, query.storeId),
      this.getMetricSeries(tenant.id, query.metric, query.period, query.year2, query.storeId),
    ]);

    return {
      metric: query.metric,
      period: query.period,
      year1: query.year1,
      year2: query.year2,
      year1Data,
      year2Data,
      rows: year1Data.map((left, index) => {
        const right = year2Data[index] ?? { period: left.period, value: 0 };
        return {
          period: left.period,
          year1Value: roundNumber(left.value),
          year2Value: roundNumber(right.value),
          changePct: left.value > 0 ? roundNumber(((right.value - left.value) / left.value) * 100) : null,
        };
      }),
    };
  }

  async getTallyExportXml(tenant: Tenant, query: TallyExportQuery): Promise<string> {
    const range = toRange(query);
    const [invoices, purchaseOrders, expenses] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: activeInvoiceStatuses },
          ...storeWhere(query.storeId),
          invoiceDate: range,
        },
        include: { customer: true },
        orderBy: { invoiceDate: "asc" },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          tenantId: tenant.id,
          status: POStatus.RECEIVED,
          ...storeWhere(query.storeId),
          receivedAt: range,
        },
        include: { supplier: true },
        orderBy: { receivedAt: "asc" },
      }),
      this.prisma.expense.findMany({
        where: {
          tenantId: tenant.id,
          ...storeWhere(query.storeId),
          paidAt: range,
        },
        orderBy: { paidAt: "asc" },
      }),
    ]);

    const vouchers = [
      ...invoices.map((invoice) => tallyVoucher({
        type: "Sales",
        date: invoice.invoiceDate,
        number: invoice.invoiceNumber,
        party: invoice.customer?.name ?? "Walk-in Customer",
        debitLedger: invoice.customer?.name ?? "Cash",
        creditLedger: "Sales Account",
        amount: invoice.grandTotal.toNumber(),
        narration: `RetailOS sales invoice ${invoice.invoiceNumber}`,
      })),
      ...purchaseOrders.map((order) => tallyVoucher({
        type: "Purchase",
        date: order.receivedAt ?? order.createdAt,
        number: order.poNumber,
        party: order.supplier.name,
        debitLedger: "Purchase Account",
        creditLedger: order.supplier.name,
        amount: order.totalAmount.toNumber(),
        narration: `RetailOS purchase order ${order.poNumber}`,
      })),
      ...expenses.map((expense) => tallyVoucher({
        type: "Payment",
        date: expense.paidAt,
        number: expense.id,
        party: expense.category,
        debitLedger: expense.category,
        creditLedger: "Cash",
        amount: expense.amount.toNumber(),
        narration: expense.description,
      })),
    ];

    return [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<ENVELOPE>",
      "<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
      "<BODY>",
      "<IMPORTDATA>",
      "<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>",
      "<REQUESTDATA>",
      ...vouchers,
      "</REQUESTDATA>",
      "</IMPORTDATA>",
      "</BODY>",
      "</ENVELOPE>",
    ].join("");
  }

  async getSparklineReport(tenant: Tenant, query: SparklineReportQuery) {
    const points = recentIstDays(query.days);
    const values = new Map(points.map((point) => [point.date, 0]));
    const range = {
      gte: points[0]?.start ?? new Date(),
      lte: points.at(-1)?.end ?? new Date(),
    };

    if (query.metric === "customers") {
      const customers = await this.prisma.customer.findMany({
        where: {
          tenantId: tenant.id,
          createdAt: range,
        },
        select: {
          createdAt: true,
        },
      });

      for (const customer of customers) {
        const key = istDateKey(customer.createdAt);
        values.set(key, (values.get(key) ?? 0) + 1);
      }
    } else {
      const invoices = await this.prisma.invoice.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: activeInvoiceStatuses },
          ...storeWhere(query.storeId),
          invoiceDate: range,
        },
        select: {
          invoiceDate: true,
          grandTotal: true,
        },
      });

      for (const invoice of invoices) {
        const key = istDateKey(invoice.invoiceDate);
        values.set(key, (values.get(key) ?? 0) + (query.metric === "revenue" ? invoice.grandTotal.toNumber() : 1));
      }
    }

    const data = points.map((point) => ({
      date: point.date,
      value: roundNumber(values.get(point.date) ?? 0),
    }));

    return {
      metric: query.metric,
      days: query.days,
      data,
    };
  }

  async getOutstandingSummary(tenant: Tenant, query: OutstandingSummaryQuery) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: activeInvoiceStatuses },
        amountDue: { gt: 0 },
        customerId: { not: null },
        ...storeWhere(query.storeId),
      },
      select: {
        customerId: true,
        amountDue: true,
        invoiceDate: true,
      },
    });

    const customerIds = new Set<string>();
    let totalOutstanding = 0;
    let oldest30Days = 0;
    let oldest60Days = 0;
    let oldest90Plus = 0;
    const now = new Date();

    for (const invoice of invoices) {
      if (invoice.customerId) {
        customerIds.add(invoice.customerId);
      }

      const due = invoice.amountDue.toNumber();
      const ageDays = daysBetween(invoice.invoiceDate, now);
      totalOutstanding += due;
      if (ageDays >= 30) {
        oldest30Days += due;
      }
      if (ageDays >= 60) {
        oldest60Days += due;
      }
      if (ageDays >= 90) {
        oldest90Plus += due;
      }
    }

    return {
      totalOutstanding: roundNumber(totalOutstanding),
      customerCount: customerIds.size,
      oldest30Days: roundNumber(oldest30Days),
      oldest60Days: roundNumber(oldest60Days),
      oldest90Plus: roundNumber(oldest90Plus),
    };
  }

  private async getMetricSeries(tenantId: string, metric: ComparisonReportQuery["metric"], period: ComparisonReportQuery["period"], year: number, storeId?: string) {
    const range = yearRange(year);
    const points = createComparisonPeriods(period);

    if (metric === "customers") {
      const customers = await this.prisma.customer.findMany({
        where: { tenantId, createdAt: { gte: range.gte, lte: range.lte } },
        select: { createdAt: true },
      });
      for (const customer of customers) {
        addComparisonValue(points, periodKey(customer.createdAt, period), 1);
      }
      return points.map((point) => ({ period: point.period, value: roundNumber(point.value) }));
    }

    if (metric === "expenses") {
      const expenses = await this.prisma.expense.findMany({
        where: { tenantId, ...storeWhere(storeId), paidAt: { gte: range.gte, lte: range.lte } },
        select: { paidAt: true, amount: true },
      });
      for (const expense of expenses) {
        addComparisonValue(points, periodKey(expense.paidAt, period), expense.amount.toNumber());
      }
      return points.map((point) => ({ period: point.period, value: roundNumber(point.value) }));
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId, status: { in: activeInvoiceStatuses }, ...storeWhere(storeId), invoiceDate: { gte: range.gte, lte: range.lte } },
      select: { invoiceDate: true, grandTotal: true },
    });
    for (const invoice of invoices) {
      addComparisonValue(points, periodKey(invoice.invoiceDate, period), metric === "revenue" ? invoice.grandTotal.toNumber() : 1);
    }

    return points.map((point) => ({ period: point.period, value: roundNumber(point.value) }));
  }
}

type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";
type StockMovementType = "adjustment" | "sale" | "purchase" | "return";
type ComparisonPeriod = "monthly" | "weekly";

interface StockMovementEvent {
  productId: string;
  productName: string;
  date: Date;
  type: StockMovementType;
  qty: number;
  reference: string;
  notes: string;
}

const agingBuckets: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

type InvoiceWithItems = Awaited<ReturnType<PrismaClient["invoice"]["findMany"]>>[number] & {
  items: Array<{
    productName: string;
    quantity: { toNumber: () => number };
    total: { toNumber: () => number };
    gstRate: { toNumber: () => number };
    cgst: { toNumber: () => number };
    sgst: { toNumber: () => number };
    product: { hsnCode: string | null; purchasePrice: { toNumber: () => number } | null; verticalData: unknown } | null;
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

function recentIstDays(days: number): Array<{ date: string; start: Date; end: Date }> {
  const today = new Date(`${istDateKey(new Date())}T00:00:00.000+05:30`);

  return Array.from({ length: days }, (_item, index) => {
    const start = new Date(today.getTime() - (days - index - 1) * 86_400_000);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return {
      date: istDateKey(start),
      start,
      end,
    };
  });
}

function istDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function storeWhere(storeId: string | undefined): { storeId?: string } {
  return storeId ? { storeId } : {};
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
  return [...grouped.values()].sort((a, b) => a.gstRate - b.gstRate);
}

function groupHsn(items: InvoiceItemForReport[]) {
  const grouped = new Map<string, { hsnCode: string; taxableValue: number; totalGst: number; totalSales: number }>();
  for (const item of items) {
    const hsnCode = item.product?.hsnCode ?? "Unspecified";
    const current = grouped.get(hsnCode) ?? { hsnCode, taxableValue: 0, totalGst: 0, totalSales: 0 };
    current.taxableValue += item.total.toNumber() - item.cgst.toNumber() - item.sgst.toNumber();
    current.totalGst += item.cgst.toNumber() + item.sgst.toNumber();
    current.totalSales += item.total.toNumber();
    grouped.set(hsnCode, current);
  }
  return [...grouped.values()].sort((a, b) => b.totalSales - a.totalSales);
}

function groupMovingItems(items: InvoiceItemForReport[]) {
  const grouped = new Map<string, { productName: string; quantitySold: number; totalSales: number }>();
  for (const item of items) {
    const current = grouped.get(item.productName) ?? { productName: item.productName, quantitySold: 0, totalSales: 0 };
    current.quantitySold += item.quantity.toNumber();
    current.totalSales += item.total.toNumber();
    grouped.set(item.productName, current);
  }
  return [...grouped.values()].sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 20);
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
  return [...grouped.values()].sort((a, b) => b.stock - a.stock);
}

function readCategory(verticalData: unknown): string {
  if (typeof verticalData !== "object" || verticalData === null || !("category" in verticalData)) return "Uncategorised";
  const category = verticalData.category;
  return typeof category === "string" && category.trim() !== "" ? category : "Uncategorised";
}

function paginate<T>(data: T[], page: number, limit: number) {
  const start = (page - 1) * limit;
  return {
    data: data.slice(start, start + limit),
    page,
    limit,
    total: data.length,
  };
}

function agingBucketFor(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(Math.floor((to.getTime() - from.getTime()) / 86_400_000), 0);
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function yearRange(year: number): { gte: Date; lte: Date } {
  return {
    gte: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
    lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
  };
}

function createComparisonPeriods(period: ComparisonPeriod): Array<{ period: string; value: number }> {
  if (period === "weekly") {
    return Array.from({ length: 53 }, (_item, index) => ({ period: `W${String(index + 1).padStart(2, "0")}`, value: 0 }));
  }

  return Array.from({ length: 12 }, (_item, index) => ({ period: String(index + 1).padStart(2, "0"), value: 0 }));
}

function periodKey(date: Date, period: ComparisonPeriod): string {
  if (period === "weekly") {
    return `W${String(weekOfYear(date)).padStart(2, "0")}`;
  }

  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

function addComparisonValue(points: Array<{ period: string; value: number }>, period: string, value: number): void {
  const point = points.find((item) => item.period === period);
  if (point) {
    point.value += value;
  }
}

function weekOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.min(Math.floor((current - start) / 604_800_000) + 1, 53);
}

function tallyVoucher(input: {
  type: "Sales" | "Purchase" | "Payment";
  date: Date;
  number: string;
  party: string;
  debitLedger: string;
  creditLedger: string;
  amount: number;
  narration: string;
}): string {
  const amount = roundNumber(input.amount).toFixed(2);
  return [
    "<TALLYMESSAGE>",
    `<VOUCHER VCHTYPE="${xml(input.type)}" ACTION="Create">`,
    `<DATE>${tallyDate(input.date)}</DATE>`,
    `<VOUCHERNUMBER>${xml(input.number)}</VOUCHERNUMBER>`,
    `<PARTYLEDGERNAME>${xml(input.party)}</PARTYLEDGERNAME>`,
    `<NARRATION>${xml(input.narration)}</NARRATION>`,
    "<ALLLEDGERENTRIES.LIST>",
    `<LEDGERNAME>${xml(input.debitLedger)}</LEDGERNAME>`,
    `<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>`,
    `<AMOUNT>${amount}</AMOUNT>`,
    "</ALLLEDGERENTRIES.LIST>",
    "<ALLLEDGERENTRIES.LIST>",
    `<LEDGERNAME>${xml(input.creditLedger)}</LEDGERNAME>`,
    `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>`,
    `<AMOUNT>-${amount}</AMOUNT>`,
    "</ALLLEDGERENTRIES.LIST>",
    "</VOUCHER>",
    "</TALLYMESSAGE>",
  ].join("");
}

function tallyDate(date: Date): string {
  return `${String(date.getUTCFullYear())}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
