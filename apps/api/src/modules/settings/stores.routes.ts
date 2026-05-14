import { UserRole } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

export class StoresError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

const storeIdParamsSchema = z.object({
  id: z.string().min(1),
});

const createStoreSchema = z.object({
  name: z.string().trim().min(2),
  address: z.string().trim().min(2).nullable().optional(),
  phone: z.string().trim().min(10).max(16).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const updateStoreSchema = createStoreSchema.partial();

const assignUsersSchema = z.object({
  userIds: z.array(z.string().min(1)).default([]),
});

const selectStoreSchema = z.object({
  storeId: z.string().min(1).nullable(),
});

export const storesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/settings/stores", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureManager(request.user.role);
      return fastify.prisma.store.findMany({
        where: {
          tenantId: request.tenant.id,
          isActive: true,
        },
        include: {
          userAssignments: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  username: true,
                  role: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: [
          { isDefault: "desc" },
          { name: "asc" },
        ],
      });
    });
  });

  fastify.put("/api/settings/stores/current", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureManager(request.user.role);
      const input = selectStoreSchema.parse(request.body);
      if (input.storeId) {
        await getStoreOrThrow(fastify, request.tenant.id, input.storeId);
      }

      await fastify.prisma.user.updateMany({
        where: {
          id: request.user.userId,
          tenantId: request.tenant.id,
        },
        data: {
          primaryStoreId: input.storeId,
        },
      });

      return {
        storeId: input.storeId,
      };
    });
  });

  fastify.post("/api/settings/stores", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureOwner(request.user.role);
      const input = createStoreSchema.parse(request.body);
      const storeCount = await fastify.prisma.store.count({
        where: {
          tenantId: request.tenant.id,
          isActive: true,
        },
      });
      const makeDefault = storeCount === 0 || input.isDefault === true;

      const store = await fastify.prisma.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.store.updateMany({
            where: {
              tenantId: request.tenant.id,
            },
            data: {
              isDefault: false,
            },
          });
        }

        return tx.store.create({
          data: {
            tenantId: request.tenant.id,
            name: input.name,
            address: input.address ?? null,
            phone: input.phone ?? null,
            isDefault: makeDefault,
          },
        });
      });

      await writeStoreAudit(fastify, request.tenant.id, request.user.userId, "STORE_CREATED", store.id, input, request.ip);
      return store;
    });
  });

  fastify.put("/api/settings/stores/:id", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureOwner(request.user.role);
      const { id } = storeIdParamsSchema.parse(request.params);
      const input = updateStoreSchema.parse(request.body);
      const result = await fastify.prisma.store.updateMany({
        where: {
          id,
          tenantId: request.tenant.id,
          isActive: true,
        },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        },
      });
      if (result.count === 0) {
        throw new StoresError("Store not found", 404);
      }

      if (input.isDefault === true) {
        await setDefaultStore(fastify, request.tenant.id, id);
      }

      await writeStoreAudit(fastify, request.tenant.id, request.user.userId, "STORE_UPDATED", id, input, request.ip);
      return getStoreOrThrow(fastify, request.tenant.id, id);
    });
  });

  fastify.put("/api/settings/stores/:id/set-default", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureOwner(request.user.role);
      const { id } = storeIdParamsSchema.parse(request.params);
      await setDefaultStore(fastify, request.tenant.id, id);
      await writeStoreAudit(fastify, request.tenant.id, request.user.userId, "STORE_SET_DEFAULT", id, {}, request.ip);
      return getStoreOrThrow(fastify, request.tenant.id, id);
    });
  });

  fastify.delete("/api/settings/stores/:id", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureOwner(request.user.role);
      const { id } = storeIdParamsSchema.parse(request.params);
      const store = await getStoreOrThrow(fastify, request.tenant.id, id);
      if (store.isDefault) {
        throw new StoresError("Default store cannot be deactivated", 409);
      }

      await fastify.prisma.$transaction([
        fastify.prisma.store.updateMany({
          where: {
            id,
            tenantId: request.tenant.id,
          },
          data: {
            isActive: false,
          },
        }),
        fastify.prisma.storeUserAssignment.deleteMany({
          where: {
            tenantId: request.tenant.id,
            storeId: id,
          },
        }),
        fastify.prisma.user.updateMany({
          where: {
            tenantId: request.tenant.id,
            primaryStoreId: id,
          },
          data: {
            primaryStoreId: null,
          },
        }),
      ]);

      await writeStoreAudit(fastify, request.tenant.id, request.user.userId, "STORE_DEACTIVATED", id, {}, request.ip);
      return { status: "ok" };
    });
  });

  fastify.put("/api/settings/stores/:id/users", async (request, reply) => {
    return handleStores(reply, async () => {
      ensureOwner(request.user.role);
      const { id } = storeIdParamsSchema.parse(request.params);
      const input = assignUsersSchema.parse(request.body);
      await getStoreOrThrow(fastify, request.tenant.id, id);
      const users = await fastify.prisma.user.findMany({
        where: {
          tenantId: request.tenant.id,
          id: {
            in: input.userIds,
          },
          isActive: true,
        },
        select: {
          id: true,
        },
      });
      if (users.length !== input.userIds.length) {
        throw new StoresError("One or more users were not found", 400);
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.storeUserAssignment.deleteMany({
          where: {
            tenantId: request.tenant.id,
            storeId: id,
          },
        });
        if (input.userIds.length > 0) {
          await tx.storeUserAssignment.createMany({
            data: input.userIds.map((userId) => ({
              tenantId: request.tenant.id,
              storeId: id,
              userId,
            })),
          });
        }
        await tx.user.updateMany({
          where: {
            tenantId: request.tenant.id,
            primaryStoreId: id,
            id: {
              notIn: input.userIds,
            },
          },
          data: {
            primaryStoreId: null,
          },
        });
        await tx.user.updateMany({
          where: {
            tenantId: request.tenant.id,
            id: {
              in: input.userIds,
            },
            primaryStoreId: null,
          },
          data: {
            primaryStoreId: id,
          },
        });
      });

      await writeStoreAudit(fastify, request.tenant.id, request.user.userId, "STORE_USERS_ASSIGNED", id, input, request.ip);
      return getStoreOrThrow(fastify, request.tenant.id, id);
    });
  });

  done();
};

async function handleStores<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof StoresError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}

function ensureOwner(role: UserRole): void {
  if (role !== UserRole.OWNER) {
    throw new StoresError("Only owners can manage stores", 403);
  }
}

function ensureManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new StoresError("Only owners and managers can view stores", 403);
  }
}

async function setDefaultStore(fastify: FastifyInstance, tenantId: string, storeId: string) {
  const store = await fastify.prisma.store.findFirst({
    where: {
      id: storeId,
      tenantId,
      isActive: true,
    },
  });
  if (!store) {
    throw new StoresError("Store not found", 404);
  }

  await fastify.prisma.$transaction([
    fastify.prisma.store.updateMany({
      where: {
        tenantId,
      },
      data: {
        isDefault: false,
      },
    }),
    fastify.prisma.store.update({
      where: {
        id: storeId,
      },
      data: {
        isDefault: true,
      },
    }),
  ]);
}

async function getStoreOrThrow(fastify: FastifyInstance, tenantId: string, storeId: string) {
  const store = await fastify.prisma.store.findFirst({
    where: {
      id: storeId,
      tenantId,
      isActive: true,
    },
    include: {
      userAssignments: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
              role: true,
            },
          },
        },
      },
    },
  });
  if (!store) {
    throw new StoresError("Store not found", 404);
  }

  return store;
}

async function writeStoreAudit(
  fastify: FastifyInstance,
  tenantId: string,
  userId: string,
  action: string,
  storeId: string,
  changes: object,
  ip: string,
) {
  await fastify.prisma.auditLog.create({
    data: {
      tenantId,
      userId,
      action,
      entity: "STORE",
      entityId: storeId,
      changes,
      ip,
    },
  });
}
