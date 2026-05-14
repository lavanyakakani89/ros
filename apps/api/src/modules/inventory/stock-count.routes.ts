import { UserRole } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { z } from "zod";

export class StockCountError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

const listQuerySchema = z.object({
  status: z.string().trim().min(1).optional(),
});

const idParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const createStockCountSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
});

const updateItemsSchema = z.object({
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    countedQty: z.coerce.number().nonnegative(),
  })).min(1),
});

export const stockCountRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/inventory/stock-counts", async (request, reply) => {
    return handleStockCount(reply, async () => {
      const query = listQuerySchema.parse(request.query);
      return fastify.prisma.stockCount.findMany({
        where: {
          tenantId: request.tenant.id,
          ...(query.status ? { status: query.status } : {}),
        },
        include: {
          _count: {
            select: {
              items: true,
            },
          },
        },
        orderBy: {
          countedAt: "desc",
        },
        take: 50,
      });
    });
  });

  fastify.post("/api/inventory/stock-counts", async (request, reply) => {
    return handleStockCount(reply, async () => {
      ensureManager(request.user.role);
      const input = createStockCountSchema.parse(request.body ?? {});
      const products = await fastify.prisma.product.findMany({
        where: {
          tenantId: request.tenant.id,
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      });

      if (products.length === 0) {
        throw new StockCountError("Create products before starting a stock count", 400);
      }

      const count = await fastify.prisma.$transaction(async (tx) => {
        const stockCount = await tx.stockCount.create({
          data: {
            tenantId: request.tenant.id,
            name: input.name ?? `Stock count - ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
            createdBy: request.user.userId,
          },
        });

        await tx.stockCountItem.createMany({
          data: products.map((product) => ({
            tenantId: request.tenant.id,
            stockCountId: stockCount.id,
            productId: product.id,
            productName: product.name,
            systemQty: product.currentStock,
            variance: 0,
          })),
        });

        return stockCount;
      });

      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "STOCK_COUNT_CREATED",
          entity: "STOCK_COUNT",
          entityId: count.id,
          changes: {
            productCount: products.length,
          },
          ip: request.ip,
        },
      });

      return getStockCountDetail(fastify, request.tenant.id, count.id);
    });
  });

  fastify.get("/api/inventory/stock-counts/:id", async (request, reply) => {
    return handleStockCount(reply, async () => {
      const { id } = idParamsSchema.parse(request.params);
      return getStockCountDetail(fastify, request.tenant.id, id);
    });
  });

  fastify.put("/api/inventory/stock-counts/:id/items", async (request, reply) => {
    return handleStockCount(reply, async () => {
      ensureManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const input = updateItemsSchema.parse(request.body);
      const count = await findTenantStockCount(fastify, request.tenant.id, id);
      ensureStatus(count.status, "OPEN", "Only open stock counts can be edited");

      const itemProductIds = new Set(count.items.map((item) => item.productId));
      for (const item of input.items) {
        if (!itemProductIds.has(item.productId)) {
          throw new StockCountError("One or more products are not part of this stock count", 400);
        }
      }

      await fastify.prisma.$transaction(input.items.map((item) => {
        const snapshot = count.items.find((countItem) => countItem.productId === item.productId);
        const systemQty = Number(snapshot?.systemQty ?? 0);
        return fastify.prisma.stockCountItem.update({
          where: {
            stockCountId_productId: {
              stockCountId: id,
              productId: item.productId,
            },
          },
          data: {
            countedQty: item.countedQty,
            variance: roundQuantity(item.countedQty - systemQty),
          },
        });
      }));

      return getStockCountDetail(fastify, request.tenant.id, id);
    });
  });

  fastify.post("/api/inventory/stock-counts/:id/submit", async (request, reply) => {
    return handleStockCount(reply, async () => {
      ensureManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const count = await findTenantStockCount(fastify, request.tenant.id, id);
      ensureStatus(count.status, "OPEN", "Only open stock counts can be submitted");
      const missingCount = count.items.filter((item) => item.countedQty === null).length;
      if (missingCount > 0) {
        throw new StockCountError(`${missingCount} products still need counted quantity`, 400);
      }

      await fastify.prisma.$transaction([
        ...count.items.map((item) => fastify.prisma.stockCountItem.update({
          where: {
            stockCountId_productId: {
              stockCountId: id,
              productId: item.productId,
            },
          },
          data: {
            variance: roundQuantity(Number(item.countedQty) - Number(item.systemQty)),
          },
        })),
        fastify.prisma.stockCount.update({
          where: {
            id,
          },
          data: {
            status: "SUBMITTED",
            submittedAt: new Date(),
          },
        }),
      ]);

      return getStockCountDetail(fastify, request.tenant.id, id);
    });
  });

  fastify.post("/api/inventory/stock-counts/:id/approve", async (request, reply) => {
    return handleStockCount(reply, async () => {
      ensureManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const count = await findTenantStockCount(fastify, request.tenant.id, id);
      ensureStatus(count.status, "SUBMITTED", "Only submitted stock counts can be approved");

      await fastify.prisma.$transaction(async (tx) => {
        for (const item of count.items) {
          const variance = roundQuantity(Number(item.variance));
          if (Math.abs(variance) < 0.0005) {
            continue;
          }

          await tx.stockAdjustment.create({
            data: {
              tenantId: request.tenant.id,
              productId: item.productId,
              quantityChange: variance,
              reason: "Physical stock count",
              notes: `Stock count ${count.name}: system ${Number(item.systemQty)}, counted ${Number(item.countedQty)}`,
              createdBy: request.user.userId,
            },
          });
          await tx.product.update({
            where: {
              id: item.productId,
            },
            data: {
              currentStock: {
                increment: variance,
              },
            },
          });
        }

        await tx.stockCount.update({
          where: {
            id,
          },
          data: {
            status: "APPROVED",
            approvedAt: new Date(),
            approvedBy: request.user.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: request.tenant.id,
            userId: request.user.userId,
            action: "STOCK_COUNT_APPROVED",
            entity: "STOCK_COUNT",
            entityId: id,
            changes: {
              varianceItems: count.items.filter((item) => Math.abs(Number(item.variance)) >= 0.0005).length,
            },
            ip: request.ip,
          },
        });
      });

      return getStockCountDetail(fastify, request.tenant.id, id);
    });
  });

  fastify.post("/api/inventory/stock-counts/:id/cancel", async (request, reply) => {
    return handleStockCount(reply, async () => {
      ensureManager(request.user.role);
      const { id } = idParamsSchema.parse(request.params);
      const count = await findTenantStockCount(fastify, request.tenant.id, id);
      ensureStatus(count.status, "OPEN", "Only open stock counts can be cancelled");
      await fastify.prisma.stockCount.update({
        where: {
          id,
        },
        data: {
          status: "CANCELLED",
        },
      });

      return getStockCountDetail(fastify, request.tenant.id, id);
    });
  });

  done();
};

async function getStockCountDetail(fastify: FastifyInstance, tenantId: string, id: string) {
  const count = await fastify.prisma.stockCount.findFirst({
    where: {
      id,
      tenantId,
    },
    include: {
      items: {
        include: {
          product: {
            select: {
              sku: true,
              barcode: true,
              unit: true,
            },
          },
        },
        orderBy: {
          productName: "asc",
        },
      },
    },
  });

  if (!count) {
    throw new StockCountError("Stock count not found", 404);
  }

  return count;
}

async function findTenantStockCount(fastify: FastifyInstance, tenantId: string, id: string) {
  return getStockCountDetail(fastify, tenantId, id);
}

function ensureManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new StockCountError("Insufficient permissions", 403);
  }
}

function ensureStatus(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new StockCountError(message, 409);
  }
}

async function handleStockCount<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof StockCountError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
