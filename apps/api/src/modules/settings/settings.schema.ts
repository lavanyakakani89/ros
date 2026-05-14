import { UserRole } from "@prisma/client";
import { z } from "zod";

import { loginIdentifierPattern, normalizeLoginIdentifier } from "../../config/login-identifiers.js";

const optionalUsernameSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(254, "Username must be 254 characters or less")
    .regex(loginIdentifierPattern, "Username cannot contain spaces")
    .transform(normalizeLoginIdentifier)
    .optional(),
);

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().trim().min(10).max(16).optional(),
  gstNumber: z.string().trim().min(15).max(15).nullable().optional(),
  gstEnabled: z.boolean().optional(),
  requirePoApproval: z.boolean().optional(),
  address: z.string().trim().min(3).nullable().optional(),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().email("Email must be a valid email address").toLowerCase(),
  username: optionalUsernameSchema,
  phone: z.string().trim().min(10, "Phone must be at least 10 digits").max(16, "Phone must be 16 digits or less").optional(),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be 128 characters or less"),
});

export const userIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").optional(),
  username: optionalUsernameSchema,
  phone: z.string().trim().min(10, "Phone must be at least 10 digits").max(16, "Phone must be 16 digits or less").nullable().optional(),
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
