import { z } from "zod";

export const loginSchema = z.object({
  tenantSlug: z.string(),
  identifier: z.string(),
  password: z.string().min(8),
});

export type LoginPayload = z.infer<typeof loginSchema>;
