import { z } from "zod";

export const reportDateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  storeId: z.string().trim().min(1).optional(),
});

export const reportExportQuerySchema = reportDateRangeSchema.extend({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});

export const customerSalesReportQuerySchema = reportDateRangeSchema.extend({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["revenue", "invoices", "outstanding"]).default("revenue"),
});

export const customerSalesReportExportQuerySchema = reportExportQuerySchema.extend({
  sortBy: z.enum(["revenue", "invoices", "outstanding"]).default("revenue"),
});

export const supplierPurchasesReportQuerySchema = reportDateRangeSchema.extend({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const supplierPurchasesReportExportQuerySchema = reportExportQuerySchema;

export const stockMovementReportQuerySchema = reportDateRangeSchema.extend({
  productId: z.string().trim().min(1).optional(),
  type: z.enum(["adjustment", "sale", "purchase", "return"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const stockMovementReportExportQuerySchema = reportExportQuerySchema.extend({
  productId: z.string().trim().min(1).optional(),
  type: z.enum(["adjustment", "sale", "purchase", "return"]).optional(),
});

export const comparisonReportQuerySchema = z.object({
  metric: z.enum(["revenue", "invoices", "customers", "expenses"]).default("revenue"),
  period: z.enum(["monthly", "weekly"]).default("monthly"),
  year1: z.coerce.number().int().min(2000).max(2100),
  year2: z.coerce.number().int().min(2000).max(2100),
  storeId: z.string().trim().min(1).optional(),
});

export const tallyExportQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  storeId: z.string().trim().min(1).optional(),
});

export const sparklineReportQuerySchema = z.object({
  metric: z.enum(["revenue", "invoices", "customers"]).default("revenue"),
  days: z.coerce.number().int().refine((value) => [7, 14, 30].includes(value), "Days must be 7, 14, or 30").default(7),
  storeId: z.string().trim().min(1).optional(),
});

export const outstandingSummaryQuerySchema = z.object({
  storeId: z.string().trim().min(1).optional(),
});

export type ReportDateRange = z.infer<typeof reportDateRangeSchema>;
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
export type CustomerSalesReportQuery = z.infer<typeof customerSalesReportQuerySchema>;
export type CustomerSalesReportExportQuery = z.infer<typeof customerSalesReportExportQuerySchema>;
export type SupplierPurchasesReportQuery = z.infer<typeof supplierPurchasesReportQuerySchema>;
export type SupplierPurchasesReportExportQuery = z.infer<typeof supplierPurchasesReportExportQuerySchema>;
export type StockMovementReportQuery = z.infer<typeof stockMovementReportQuerySchema>;
export type StockMovementReportExportQuery = z.infer<typeof stockMovementReportExportQuerySchema>;
export type ComparisonReportQuery = z.infer<typeof comparisonReportQuerySchema>;
export type TallyExportQuery = z.infer<typeof tallyExportQuerySchema>;
export type SparklineReportQuery = z.infer<typeof sparklineReportQuerySchema>;
export type OutstandingSummaryQuery = z.infer<typeof outstandingSummaryQuerySchema>;
