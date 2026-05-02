import { PaymentMode } from "@prisma/client";
import { z } from "zod";

const decimalSchema = z.coerce.number().finite();

export const invoiceIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
});

const invoiceItemSchema = z.object({
  productId: z.string().min(1),
  quantity: decimalSchema.positive(),
  discount: decimalSchema.nonnegative().default(0),
  batchNumber: z.string().trim().min(1).optional(),
  expiryDate: z.coerce.date().optional(),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().min(1).optional(),
  dueDate: z.coerce.date().optional(),
  paymentMode: z.nativeEnum(PaymentMode).default(PaymentMode.CASH),
  verticalData: z.record(z.unknown()).optional(),
  notes: z.string().trim().min(1).optional(),
  items: z.array(invoiceItemSchema).min(1),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  items: z.array(invoiceItemSchema).min(1).optional(),
});
