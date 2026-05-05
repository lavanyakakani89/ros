import { z } from "zod";

const decimalSchema = z.coerce.number().finite();

export const productIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).optional(),
  lowStock: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});

const productSchema = z.object({
  name: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  barcode: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  partGroup: z.string().trim().min(1).optional(),
  legacySubCategoryId: z.string().trim().min(1),
  unit: z.string().trim().min(1).default("piece"),
  mrp: decimalSchema.nonnegative(),
  sellingPrice: decimalSchema.nonnegative(),
  purchasePrice: decimalSchema.nonnegative().optional(),
  wholesalePrice: decimalSchema.nonnegative().optional(),
  defaultDiscountPercent: decimalSchema.min(0).max(100).optional(),
  gstRate: decimalSchema.min(0).max(28),
  cessRate: decimalSchema.min(0).max(100).default(0),
  hsnCode: z.string().trim().min(1).optional(),
  currentStock: decimalSchema.default(0),
  reorderLevel: decimalSchema.nonnegative().optional(),
  purchaseUnit: z.string().trim().min(1).optional(),
  salesUnit: z.string().trim().min(1),
  alternateUnit: z.string().trim().min(1).optional(),
  conversionValue: decimalSchema.positive().optional(),
  godown: z.string().trim().min(1).optional(),
  rack: z.string().trim().min(1).optional(),
  defaultSaleQty: decimalSchema.positive().optional(),
  supplierId: z.string().min(1).optional(),
  verticalData: z.record(z.unknown()).optional(),
});

export const createProductSchema = productSchema.superRefine((input, context) => {
  const category = input.verticalData?.category;
  if (typeof category !== "string" || category.trim() === "") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verticalData", "category"],
      message: "Category is required",
    });
  }
});

export const updateProductSchema = productSchema.partial();

export const addBatchSchema = z.object({
  batchNumber: z.string().trim().min(1),
  mfgDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date(),
  quantity: decimalSchema.positive(),
  purchasePrice: decimalSchema.nonnegative(),
});

export const expiringQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1),
  quantityChange: decimalSchema.refine((value) => value !== 0, "Quantity change cannot be zero"),
  reason: z.string().trim().min(3),
  notes: z.string().trim().min(1).optional(),
});
