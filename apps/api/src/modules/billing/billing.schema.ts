import { createInvoiceItemSchema, createInvoiceSchema, confirmInvoiceSchema } from "@retailos/shared";
import { z } from "zod";

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
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  customerId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  items: z.array(createInvoiceItemSchema).min(1).optional(),
});

export { createInvoiceItemSchema, createInvoiceSchema, confirmInvoiceSchema };
