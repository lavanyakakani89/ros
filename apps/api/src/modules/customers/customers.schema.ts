import { z } from "zod";

const decimalSchema = z.coerce.number().finite();
const customerLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  source: z.enum(["GOOGLE_MAPS_URL", "COORDINATES"]).default("COORDINATES"),
  query: z.string().trim().min(1).max(2048).optional(),
});

export const customerListQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export const customerIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const createCustomerSchema = z.object({
  customerCode: z.string().trim().min(1),
  name: z.string().trim().min(2),
  phone: z.string().trim().min(10).max(16),
  email: z.string().trim().email().optional(),
  address: z.string().trim().min(3),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  remarks: z.string().trim().min(1).optional(),
  accountNo: z.string().trim().min(1).optional(),
  accountName: z.string().trim().min(1).optional(),
  bank: z.string().trim().min(1).optional(),
  branch: z.string().trim().min(1).optional(),
  ifscCode: z.string().trim().min(1).optional(),
  gstin: z.string().trim().min(1).optional(),
  pan: z.string().trim().min(1).optional(),
  cin: z.string().trim().min(1).optional(),
  openingBalanceType: z.enum(["CR", "DR"]).optional(),
  openingBalance: decimalSchema.nonnegative().default(0),
  tcsEnabled: z.coerce.boolean().default(false),
  creditLimit: decimalSchema.nonnegative().optional(),
  creditLimitEnabled: z.coerce.boolean().default(false),
  creditDays: z.coerce.number().int().nonnegative().optional(),
  itemDiscountPercent: decimalSchema.min(0).max(100).default(0),
  itemDiscountEnabled: z.coerce.boolean().default(false),
  location: customerLocationSchema.optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
