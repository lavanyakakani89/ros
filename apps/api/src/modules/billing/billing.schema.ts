import { PaymentMode } from "@prisma/client";
import { z } from "zod";

import { dateParamSchema } from "../../lib/date-range.js";

const decimalSchema = z.coerce.number().finite();
const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined) return false;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return value;
}, z.boolean()).default(false);

export const invoiceIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().trim().min(1).optional(),
  unpaid: queryBooleanSchema,
  customerId: z.string().trim().min(1).optional(),
  storeId: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  from: dateParamSchema("start"),
  to: dateParamSchema("end"),
});

const invoiceItemSchema = z.object({
  productId: z.string().min(1),
  quantity: decimalSchema.positive(),
  sellingPrice: decimalSchema.nonnegative().optional(),
  discount: decimalSchema.nonnegative().default(0),
  discountPercent: decimalSchema.min(0).max(100).optional(),
  batchNumber: z.string().trim().min(1).optional(),
  expiryDate: z.coerce.date().optional(),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  dueDate: z.coerce.date().optional(),
  paymentMode: z.nativeEnum(PaymentMode).default(PaymentMode.CASH),
  billDiscount: decimalSchema.nonnegative().default(0),
  verticalData: z.record(z.unknown()).optional(),
  notes: z.string().trim().min(1).optional(),
  items: z.array(invoiceItemSchema).min(1),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  customerId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  items: z.array(invoiceItemSchema).min(1).optional(),
});
