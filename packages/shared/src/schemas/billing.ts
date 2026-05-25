import { z } from "zod";

export const paymentModeValues = ["CASH", "UPI", "CARD", "CREDIT", "NETBANKING"] as const;

const decimalSchema = z.coerce.number().finite();

export const createInvoiceItemSchema = z.object({
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
  paymentMode: z.enum(paymentModeValues).default("CASH"),
  billDiscount: decimalSchema.nonnegative().default(0),
  verticalData: z.record(z.unknown()).optional(),
  notes: z.string().trim().min(1).optional(),
  items: z.array(createInvoiceItemSchema).min(1),
});

export const confirmInvoiceSchema = z.object({
  paymentMode: z.enum(paymentModeValues).optional(),
  amountReceived: decimalSchema.nonnegative().optional(),
});

export type CreateInvoicePayload = z.infer<typeof createInvoiceSchema>;
export type CreateInvoiceItemPayload = z.infer<typeof createInvoiceItemSchema>;
export type ConfirmInvoicePayload = z.infer<typeof confirmInvoiceSchema>;
