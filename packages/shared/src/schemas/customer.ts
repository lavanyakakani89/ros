import { z } from "zod";

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(10),
  address: z.string().trim().min(1).optional(),
});

export type CreateCustomerPayload = z.infer<typeof createCustomerSchema>;
