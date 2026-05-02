import type { UserRole, VerticalType } from "@prisma/client";

export interface AuthUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface RegisterInput {
  tenantName: string;
  tenantSlug: string;
  vertical: VerticalType;
  gstNumber?: string | undefined;
  phone: string;
  address?: string | undefined;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string | undefined;
  password: string;
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken?: string | undefined;
}
