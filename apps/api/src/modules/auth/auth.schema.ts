import { VerticalType } from "@prisma/client";
import { z } from "zod";

export const registerSchema = z.object({
  tenantName: z.string().trim().min(2),
  tenantSlug: z
    .string()
    .trim()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  vertical: z.nativeEnum(VerticalType),
  gstNumber: z.string().trim().min(15).max(15).optional(),
  phone: z.string().trim().min(10).max(16),
  address: z.string().trim().min(3).optional(),
  ownerName: z.string().trim().min(2),
  ownerEmail: z.string().trim().email().toLowerCase(),
  ownerPhone: z.string().trim().min(10).max(16).optional(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  tenantSlug: z.string().trim().min(3).toLowerCase(),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(32).optional(),
});

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
export type RefreshRequest = z.infer<typeof refreshSchema>;
export type LogoutRequest = z.infer<typeof logoutSchema>;
