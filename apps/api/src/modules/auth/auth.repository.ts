import type { PrismaClient, RefreshToken, User } from "@prisma/client";
import { UserRole } from "@prisma/client";

import type { RegisterInput } from "./auth.types.js";

export interface UserWithTenant extends User {
  tenant: {
    id: string;
    slug: string;
  };
}

export interface RefreshTokenWithUser extends RefreshToken {
  user: User;
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
          ...(input.ownerPhone ? { phone: input.ownerPhone } : {}),
          passwordHash,
          role: UserRole.OWNER,
        },
        include: {
          tenant: {
            select: {
              id: true,
              slug: true,
            },
          },
        },
      });
    });
  }

  async findUserForLogin(tenantSlug: string, email: string): Promise<UserWithTenant | null> {
    return this.prisma.user.findFirst({
      where: {
        email,
        tenant: {
          slug: tenantSlug,
        },
      },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
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
