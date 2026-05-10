import type { PrismaClient, RefreshToken, User } from "@prisma/client";
import { UserRole } from "@prisma/client";

import { defaultUsername, normalizeLoginIdentifier } from "../../config/login-identifiers.js";
import type { RegisterInput } from "./auth.types.js";

export interface UserWithTenant extends User {
  tenant: {
    id: string;
    slug: string;
    status: string;
  };
}

export interface RefreshTokenWithUser extends RefreshToken {
  user: User;
  tenant: {
    id: string;
    status: string;
  };
}

export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createTenantWithOwner(input: RegisterInput, passwordHash: string): Promise<UserWithTenant> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName,
          slug: input.tenantSlug,
          vertical: input.vertical,
          phone: input.phone,
          ...(input.gstNumber ? { gstNumber: input.gstNumber } : {}),
          ...(input.address ? { address: input.address } : {}),
        },
      });

      return tx.user.create({
        data: {
          tenantId: tenant.id,
          name: input.ownerName,
          email: input.ownerEmail,
          username: defaultUsername(input.ownerUsername ?? input.ownerEmail),
          ...(input.ownerPhone ? { phone: input.ownerPhone } : {}),
          passwordHash,
          role: UserRole.OWNER,
        },
        include: {
          tenant: {
            select: {
              id: true,
              slug: true,
              status: true,
            },
          },
        },
      });
    });
  }

  async findUserForLogin(tenantSlug: string, identifier: string): Promise<UserWithTenant | null> {
    const normalizedIdentifier = normalizeLoginIdentifier(identifier);

    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedIdentifier }, { username: normalizedIdentifier }],
        isActive: true,
        tenant: {
          slug: tenantSlug,
        },
      },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            status: true,
          },
        },
      },
    });
  }

  async createRefreshToken(input: {
    id: string;
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.refreshToken.create({
      data: input,
    });
  }

  async findRefreshToken(id: string): Promise<RefreshTokenWithUser | null> {
    return this.prisma.refreshToken.findUnique({
      where: { id },
      include: {
        user: true,
        tenant: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
