import { UserRole } from "@prisma/client";
import { z } from "zod";

import { loginIdentifierPattern, normalizeLoginIdentifier } from "../../config/login-identifiers.js";

const optionalUsernameSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .min(3)
    .max(254)
    .regex(loginIdentifierPattern, "Username cannot contain spaces")
    .transform(normalizeLoginIdentifier)
    .optional(),
);

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().trim().min(10).max(16).optional(),
  gstNumber: z.string().trim().min(15).max(15).nullable().optional(),
  gstEnabled: z.boolean().optional(),
  address: z.string().trim().min(3).nullable().optional(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().toLowerCase(),
  username: optionalUsernameSchema,
  phone: z.string().trim().min(10).max(16).optional(),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8).max(128),
});

export const userIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  username: optionalUsernameSchema,
  phone: z.string().trim().min(10).max(16).nullable().optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
