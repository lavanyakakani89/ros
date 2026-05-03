import { z } from "zod";

const decimalSchema = z.coerce.number().finite();

export const customerListQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const customerIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().min(10).max(16),
  email: z.string().trim().email().optional(),
  address: z.string().trim().min(3).optional(),
  creditLimit: decimalSchema.nonnegative().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
