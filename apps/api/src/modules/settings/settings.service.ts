import { hash, verify } from "@node-rs/argon2";
import { Prisma, UserRole, type PrismaClient, type Tenant } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { defaultUsername, normalizeLoginIdentifier } from "../../config/login-identifiers.js";
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
    const [users, store] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          tenantId: tenant.id,
        },
        select: userSelect,
        orderBy: {
          createdAt: "asc",
        },
      }),
      this.getDefaultStore(tenant.id),
    ]);

    return {
      tenant,
      store,
      users,
    };
  }

  async updateTenant(tenant: Tenant, input: UpdateTenantInput) {
    return this.prisma.$transaction(async (tx) => {
      const updatedTenant = await tx.tenant.update({
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

      const storeChanged = input.name !== undefined || input.phone !== undefined || input.address !== undefined || input.depotName !== undefined || input.depotAddress !== undefined || input.depotLatitude !== undefined || input.depotLongitude !== undefined;
      if (storeChanged) {
        const store = await tx.store.findFirst({
          where: {
            tenantId: tenant.id,
            isActive: true,
          },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });

        if (!store) {
          throw new SettingsError("Store not found", 404);
        }

        await tx.store.update({
          where: { id: store.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.depotName !== undefined ? { depotName: input.depotName } : {}),
            ...(input.depotAddress !== undefined ? { depotAddress: input.depotAddress } : {}),
            ...(input.depotLatitude !== undefined ? { depotLatitude: input.depotLatitude } : {}),
            ...(input.depotLongitude !== undefined ? { depotLongitude: input.depotLongitude } : {}),
          },
        });
      }

      return updatedTenant;
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
    const username = defaultUsername(input.username ?? input.email);
    await this.ensureLoginIdentifiersAvailable(tenant.id, [input.email, username]);

    try {
      return await this.prisma.user.create({
        data: {
          tenantId: tenant.id,
          name: input.name,
          email: input.email,
          username,
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

    if (input.username !== undefined) {
      await this.ensureLoginIdentifiersAvailable(tenant.id, [input.username], userId);
    }

    const result = await this.prisma.user.updateMany({
      where: {
        id: userId,
        tenantId: tenant.id,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.username !== undefined ? { username: normalizeLoginIdentifier(input.username) } : {}),
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

  async deleteUser(tenant: Tenant, currentUser: { userId: string; role: UserRole }, userId: string) {
    ensureManager(currentUser.role);

    if (userId === currentUser.userId) {
      throw new SettingsError("You cannot delete your own account", 409);
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      throw new SettingsError("User not found", 404);
    }

    if (user.role === UserRole.OWNER && currentUser.role !== UserRole.OWNER) {
      throw new SettingsError("Only an owner can delete another owner", 403);
    }

    if (user.role === UserRole.OWNER) {
      const ownerCount = await this.prisma.user.count({
        where: {
          tenantId: tenant.id,
          role: UserRole.OWNER,
        },
      });
      if (ownerCount <= 1) {
        throw new SettingsError("At least one owner must remain active in the shop", 409);
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.refreshToken.deleteMany({ where: { tenantId: tenant.id, userId } });
        await tx.appNotification.deleteMany({ where: { tenantId: tenant.id, userId } });
        await tx.user.delete({
          where: {
            id: userId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new SettingsError("This user is linked to business history. Deactivate the user instead of deleting.", 409);
      }
      throw error;
    }

    return { deleted: true };
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

  private async ensureLoginIdentifiersAvailable(tenantId: string, rawIdentifiers: string[], excludeUserId?: string): Promise<void> {
    const identifiers = [...new Set(rawIdentifiers.map(normalizeLoginIdentifier).filter(Boolean))];

    if (identifiers.length === 0) {
      return;
    }

    const conflict = await this.prisma.user.findFirst({
      where: {
        tenantId,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        OR: identifiers.flatMap((identifier) => [{ email: identifier }, { username: identifier }]),
      },
      select: {
        id: true,
      },
    });

    if (conflict) {
      throw new SettingsError("Username or email already exists. Use a different login name.", 409);
    }
  }

  private getDefaultStore(tenantId: string) {
    return this.prisma.store.findFirst({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        depotName: true,
        depotAddress: true,
        depotLatitude: true,
        depotLongitude: true,
      },
    });
  }
}

const userSelect = {
  id: true,
  tenantId: true,
  name: true,
  email: true,
  username: true,
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
