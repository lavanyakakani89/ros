import { hash, verify } from "@node-rs/argon2";
import { UserRole, type PrismaClient, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import type { ChangePasswordInput, CreateUserInput, UpdateTenantInput, UpdateUserInput } from "./settings.schema.js";

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class SettingsService {
  private readonly prisma: PrismaClient;

  constructor(fastify: FastifyInstance) {
    this.prisma = fastify.prisma;
  }

  async getCurrentTenant(tenant: Tenant) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: userSelect,
      orderBy: {
        createdAt: "asc",
      },
    });

    return {
      tenant,
      users,
    };
  }

  async updateTenant(tenant: Tenant, input: UpdateTenantInput) {
    return this.prisma.tenant.update({
      where: {
        id: tenant.id,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.gstNumber !== undefined ? { gstNumber: input.gstNumber } : {}),
        ...(input.gstEnabled !== undefined ? { gstEnabled: input.gstEnabled } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
      },
    });
  }

  listUsers(tenant: Tenant) {
    return this.prisma.user.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: userSelect,
      orderBy: {
        createdAt: "asc",
      },
    });
  }

  async createUser(tenant: Tenant, currentUser: { role: UserRole }, input: CreateUserInput) {
    ensureManager(currentUser.role);

    try {
      return await this.prisma.user.create({
        data: {
          tenantId: tenant.id,
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          role: input.role,
          ...(input.phone ? { phone: input.phone } : {}),
        },
        select: userSelect,
      });
    } catch (error) {
      throw new SettingsError(error instanceof Error ? error.message : "Unable to create user", 409);
    }
  }

  async updateUser(tenant: Tenant, currentUser: { userId: string; role: UserRole }, userId: string, input: UpdateUserInput) {
    ensureManager(currentUser.role);

    if (userId === currentUser.userId && input.isActive === false) {
      throw new SettingsError("You cannot deactivate your own account", 409);
    }

    const result = await this.prisma.user.updateMany({
      where: {
        id: userId,
        tenantId: tenant.id,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    if (result.count === 0) {
      throw new SettingsError("User not found", 404);
    }

    if (input.isActive === false) {
      await this.prisma.refreshToken.updateMany({
        where: {
          tenantId: tenant.id,
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    return this.prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        tenantId: tenant.id,
      },
      select: userSelect,
    });
  }

  async changePassword(tenant: Tenant, currentUser: { userId: string }, input: ChangePasswordInput) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: currentUser.userId,
        tenantId: tenant.id,
        isActive: true,
      },
    });

    if (!user || !(await verify(user.passwordHash, input.currentPassword))) {
      throw new SettingsError("Current password is incorrect", 401);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: {
          id: currentUser.userId,
        },
        data: {
          passwordHash: await hashPassword(input.newPassword),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          tenantId: tenant.id,
          userId: currentUser.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);

    return {
      status: "ok",
    };
  }
}

const userSelect = {
  id: true,
  tenantId: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
};

function ensureManager(role: UserRole): void {
  const allowedRoles: UserRole[] = [UserRole.OWNER, UserRole.MANAGER];
  if (!allowedRoles.includes(role)) {
    throw new SettingsError("Only owners and managers can manage users", 403);
  }
}

async function hashPassword(value: string): Promise<string> {
  return hash(value, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}
