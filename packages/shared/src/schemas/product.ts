import { z } from "zod";

const decimalSchema = z.coerce.number().finite();

const productSchema = z.object({
  name: z.string().trim().min(1),
  sku: z.string().trim().min(1).optional(),
  barcode: z.string().trim().min(1).optional(),
  unit: z.string().trim().min(1).default("piece"),
  mrp: decimalSchema.nonnegative(),
  sellingPrice: decimalSchema.nonnegative(),
  purchasePrice: decimalSchema.nonnegative().optional(),
  gstRate: decimalSchema.min(0).max(28).default(0),
  hsnCode: z.string().trim().min(1).optional(),
  reorderLevel: decimalSchema.nonnegative().optional(),
  category: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  verticalData: z.record(z.unknown()).optional(),
});

export const createProductSchema = productSchema;
export const updateProductSchema = productSchema.partial();

export const stockAdjustmentSchema = z.object({
  productId: z.string().min(1),
  direction: z.enum(["ADD", "REMOVE"]).optional(),
  quantity: decimalSchema.positive().optional(),
  quantityChange: decimalSchema.refine((value) => value !== 0, "Quantity change cannot be zero").optional(),
  reason: z.string().trim().min(3),
  notes: z.string().trim().min(1).optional(),
});

export type CreateProductPayload = z.infer<typeof createProductSchema>;
export type UpdateProductPayload = z.infer<typeof updateProductSchema>;
export type StockAdjustmentPayload = z.infer<typeof stockAdjustmentSchema>;
