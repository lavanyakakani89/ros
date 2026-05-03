import { z } from "zod";

export const supplierListQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const supplierIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().min(10).max(16),
  email: z.string().trim().email().optional(),
  gstNumber: z.string().trim().min(15).max(15).optional(),
  address: z.string().trim().min(3).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
