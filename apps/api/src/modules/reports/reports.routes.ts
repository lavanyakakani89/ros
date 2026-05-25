import { z } from "zod";
import * as XLSX from "xlsx";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

import {
  comparisonReportQuerySchema,
  customerSalesReportExportQuerySchema,
  customerSalesReportQuerySchema,
  reportDateRangeSchema,
  reportExportQuerySchema,
  stockMovementReportExportQuerySchema,
  stockMovementReportQuerySchema,
  sparklineReportQuerySchema,
  outstandingSummaryQuerySchema,
  supplierPurchasesReportExportQuerySchema,
  supplierPurchasesReportQuerySchema,
  tallyExportQuerySchema,
} from "./reports.schema.js";
import { ReportsService } from "./reports.service.js";

type ReportCell = string | number | boolean | null | undefined;
type ReportRow = Record<string, ReportCell>;

export class ReportsError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export const reportsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const service = new ReportsService(fastify);

  fastify.get("/api/reports/summary", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    return service.getSalesSummary(request.tenant, query);
  });

  fastify.get("/api/reports/summary/export", async (request, reply) => {
    const query = scopedQuery(request.user.role, request.storeId, reportExportQuerySchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return sendReport(reply, "summary", query.format, [{
      grossSales: summary.grossSales,
      netSales: summary.netSales,
      discountTotal: summary.discountTotal,
      totalGst: summary.totalGst,
      invoiceCount: summary.invoiceCount,
      averageBillValue: summary.averageBillValue,
      paid: summary.paid,
      due: summary.due,
    }]);
  });

  fastify.get("/api/reports/daily-sales", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return summary.dailySales;
  });

  fastify.get("/api/reports/daily-sales/export", async (request, reply) => {
    const query = scopedQuery(request.user.role, request.storeId, reportExportQuerySchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return sendReport(reply, "daily-sales", query.format, summary.dailySales);
  });

  fastify.get("/api/reports/gst", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return { gstByRate: summary.gstByRate, hsnSummary: summary.hsnSummary, totalCgst: summary.totalCgst, totalSgst: summary.totalSgst };
  });

  fastify.get("/api/reports/gst-summary", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return { gstByRate: summary.gstByRate, hsnSummary: summary.hsnSummary, totalCgst: summary.totalCgst, totalSgst: summary.totalSgst };
  });

  fastify.get("/api/reports/gst/export", async (request, reply) => {
    const query = scopedQuery(request.user.role, request.storeId, reportExportQuerySchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    const rows = [
      ...summary.gstByRate.map((row) => ({ section: "GST rate", ...row })),
      ...summary.hsnSummary.map((row) => ({ section: "HSN", ...row })),
    ];
    return sendReport(reply, "gst", query.format, rows);
  });

  fastify.get("/api/reports/moving-items", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return summary.movingItems;
  });

  fastify.get("/api/reports/moving-items/export", async (request, reply) => {
    const query = scopedQuery(request.user.role, request.storeId, reportExportQuerySchema.parse(request.query));
    const summary = await service.getSalesSummary(request.tenant, query);
    return sendReport(reply, "moving-items", query.format, summary.movingItems);
  });

  fastify.get("/api/reports/inventory", async (request) => {
    return service.getInventorySummary(request.tenant);
  });

  fastify.get("/api/reports/stock-value", async (request) => {
    const inventory = await service.getInventorySummary(request.tenant);
    return {
      stockValue: inventory.stockValue,
      lowStockCount: inventory.lowStockCount,
      stockByCategory: inventory.stockByCategory,
    };
  });

  fastify.get("/api/reports/inventory/export", async (request, reply) => {
    const query = reportExportQuerySchema.parse(request.query);
    const inventory = await service.getInventorySummary(request.tenant);
    const rows = [
      { metric: "Stock value", value: inventory.stockValue },
      { metric: "Low stock count", value: inventory.lowStockCount },
      ...inventory.stockByCategory.map((row) => ({ metric: "Stock by category", category: row.category, products: row.products, stock: row.stock })),
    ];
    return sendReport(reply, "inventory", query.format, rows);
  });

  fastify.get("/api/reports/pnl", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    return service.getPnlReport(request.tenant, query);
  });

  fastify.get("/api/reports/pl", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    return service.getPnlReport(request.tenant, query);
  });

  fastify.get("/api/reports/pnl/export", async (request, reply) => {
    const query = scopedQuery(request.user.role, request.storeId, reportExportQuerySchema.parse(request.query));
    const pnl = await service.getPnlReport(request.tenant, query);
    const rows = [
      { productName: "TOTAL", quantitySold: "", revenue: pnl.revenue, cost: pnl.cost, profit: pnl.grossProfit, marginPct: pnl.grossMarginPct },
      ...pnl.items,
    ];
    return sendReport(reply, "pnl", query.format, rows);
  });

  fastify.get("/api/reports/customer-sales", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, customerSalesReportQuerySchema.parse(request.query));
    return service.getCustomerSalesReport(request.tenant, query);
  });

  fastify.get("/api/reports/customer-sales/export", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, customerSalesReportExportQuerySchema.parse(request.query));
    const report = await service.getCustomerSalesReport(request.tenant, { ...query, page: 1, limit: 100_000 });
    return sendReport(reply, "customer-sales", query.format, report.data.map((row) => ({
      customer: row.name,
      phone: row.phone,
      invoices: row.invoiceCount,
      revenue: row.totalRevenue,
      paid: row.totalPaid,
      outstanding: row.outstanding,
      lastPurchaseDate: row.lastPurchaseDate,
    })));
  }));

  fastify.get("/api/reports/supplier-purchases", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, supplierPurchasesReportQuerySchema.parse(request.query));
    return service.getSupplierPurchasesReport(request.tenant, query);
  });

  fastify.get("/api/reports/supplier-purchases/export", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, supplierPurchasesReportExportQuerySchema.parse(request.query));
    const report = await service.getSupplierPurchasesReport(request.tenant, { ...query, page: 1, limit: 100_000 });
    return sendReport(reply, "supplier-purchases", query.format, report.data.map((row) => ({
      supplier: row.name,
      phone: row.phone,
      purchaseOrders: row.poCount,
      purchased: row.totalPurchased,
      paid: row.totalPaid,
      outstanding: row.outstanding,
    })));
  }));

  fastify.get("/api/reports/outstanding-aging", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, reportDateRangeSchema.parse(request.query));
    return service.getOutstandingAgingReport(request.tenant, query);
  });

  fastify.get("/api/reports/outstanding-aging/export", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, reportExportQuerySchema.parse(request.query));
    const report = await service.getOutstandingAgingReport(request.tenant, query);
    return sendReport(reply, "outstanding-aging", query.format, report.customers.map((row) => ({
      customer: row.name,
      phone: row.phone,
      outstanding: row.totalOutstanding,
      invoices: row.invoiceCount,
      oldestUnpaidDate: row.oldestInvoiceDate,
      bucket: row.bucket,
    })));
  }));

  fastify.get("/api/reports/stock-movement", async (request) => {
    const query = scopedQuery(request.user.role, request.storeId, stockMovementReportQuerySchema.parse(request.query));
    return service.getStockMovementReport(request.tenant, query);
  });

  fastify.get("/api/reports/stock-movement/export", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, stockMovementReportExportQuerySchema.parse(request.query));
    const report = await service.getStockMovementReport(request.tenant, { ...query, page: 1, limit: 100_000 });
    return sendReport(reply, "stock-movement", query.format, report.data.map((row) => ({
      date: row.date,
      product: row.productName,
      type: row.type,
      quantityChange: row.qty,
      runningBalance: row.runningBalance,
      reference: row.reference,
      notes: row.notes,
    })));
  }));

  fastify.get("/api/reports/comparison", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, comparisonReportQuerySchema.parse(request.query));
    if (query.year1 === query.year2) {
      throw new ReportsError("Select two different years to compare", 400);
    }
    return service.getComparisonReport(request.tenant, query);
  }));

  fastify.get("/api/reports/tally-export", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, tallyExportQuerySchema.parse(request.query));
    const xml = await service.getTallyExportXml(request.tenant, query);
    return reply
      .header("Content-Type", "application/xml; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="tally-export-${datePart(query.from)}-${datePart(query.to)}.xml"`)
      .send(xml);
  }));

  fastify.get("/api/reports/sparkline", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, sparklineReportQuerySchema.parse(request.query));
    return service.getSparklineReport(request.tenant, query);
  }));

  fastify.get("/api/reports/outstanding-summary", async (request, reply) => handleReports(reply, async () => {
    const query = scopedQuery(request.user.role, request.storeId, outstandingSummaryQuerySchema.parse(request.query));
    return service.getOutstandingSummary(request.tenant, query);
  }));

  fastify.get("/api/reports/day-end", async (request) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.query);
    return service.getDayEndReport(request.tenant, date);
  });

  done();
};

async function handleReports<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ReportsError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Validation failed", issues: error.flatten() });
    }

    throw error;
  }
}

function sendReport(reply: FastifyReply, name: string, format: "csv" | "xlsx", rows: ReportRow[]) {
  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ message: "No data" }]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Report");
    const output: unknown = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const buffer = Buffer.isBuffer(output) ? output : Buffer.from(String(output));
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${name}.xlsx"`)
      .send(buffer);
  }

  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${name}.csv"`)
    .send(toCsv(rows));
}

function toCsv(rows: ReportRow[]): string {
  if (rows.length === 0) {
    return "message\r\nNo data\r\n";
  }

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n");
}

function csvCell(value: ReportCell): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function datePart(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function scopedQuery<T extends { storeId?: string | undefined }>(
  role: string,
  sessionStoreId: string | null | undefined,
  query: T,
): T & { storeId?: string | undefined } {
  if (role === "OWNER" || role === "MANAGER") {
    return query.storeId || !sessionStoreId ? query : { ...query, storeId: sessionStoreId };
  }

  return sessionStoreId ? { ...query, storeId: sessionStoreId } : query;
}
