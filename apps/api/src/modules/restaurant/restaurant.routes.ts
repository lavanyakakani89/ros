import { z } from "zod";
import { PaymentMode, Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { BillingService } from "../billing/billing.service.js";

export class RestaurantError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const tableSchema = z.object({
  number: z.string().min(1),
  capacity: z.coerce.number().int().positive().default(4),
  section: z.string().optional(),
});

const tableIdParamsSchema = z.object({
  tableId: z.string().min(1),
});

const kotIdParamsSchema = z.object({
  id: z.string().min(1),
});

const kotItemSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().default("piece"),
  notes: z.string().optional(),
  modifiers: z.array(z.object({ groupName: z.string(), optionName: z.string(), extraPrice: z.number() })).optional(),
});

const createKotSchema = z.object({
  tableId: z.string().optional(),
  customerId: z.string().optional(),
  items: z.array(kotItemSchema).min(1),
});

const menuCategorySchema = z.object({
  name: z.string().min(1),
  sortOrder: z.coerce.number().int().default(0),
});

const modifierGroupSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().default(false),
  multiSelect: z.boolean().default(false),
  options: z.array(z.object({ name: z.string().min(1), extraPrice: z.coerce.number().nonnegative().default(0) })).min(1),
});

const recipeItemSchema = z.object({
  ingredientProductId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1),
});

export const restaurantRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const billingService = new BillingService(fastify);

  // ---- TABLES ----
  fastify.get("/api/restaurant/tables", async (request) => {
    const { status } = z.object({ status: z.string().optional() }).parse(request.query);
    return fastify.prisma.restaurantTable.findMany({
      where: { tenantId: request.tenant.id, ...(status ? { status: status as "AVAILABLE" | "OCCUPIED" | "RESERVED" | "CLEANING" } : {}) },
      include: { kots: { where: { status: { not: "CANCELLED" }, billedAt: null } } },
      orderBy: { number: "asc" },
    });
  });

  fastify.post("/api/restaurant/tables", async (request) => {
    const input = tableSchema.parse(request.body);
    return fastify.prisma.restaurantTable.create({
      data: {
        tenantId: request.tenant.id,
        number: input.number,
        capacity: input.capacity,
        section: input.section ?? null,
      },
    });
  });

  fastify.put("/api/restaurant/tables/:id/status", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { status } = z.object({ status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING"]) }).parse(request.body);
    const result = await fastify.prisma.restaurantTable.updateMany({ where: { id, tenantId: request.tenant.id }, data: { status } });
    if (result.count === 0) return reply.status(404).send({ error: "Table not found" });
    return { status: "ok" };
  });

  fastify.delete("/api/restaurant/tables/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await fastify.prisma.restaurantTable.deleteMany({ where: { id, tenantId: request.tenant.id } });
    if (result.count === 0) return reply.status(404).send({ error: "Table not found" });
    return { status: "ok" };
  });

  fastify.post("/api/restaurant/tables/:tableId/bill", async (request, reply) => {
    return handleError(reply, async () => {
      const { tableId } = tableIdParamsSchema.parse(request.params);
      const table = await fastify.prisma.restaurantTable.findFirst({
        where: {
          id: tableId,
          tenantId: request.tenant.id,
        },
      });

      if (!table) {
        throw new RestaurantError("Table not found", 404);
      }

      const kots = await fastify.prisma.kOT.findMany({
        where: {
          tenantId: request.tenant.id,
          tableId,
          status: "SERVED",
          billedAt: null,
        },
        include: {
          items: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      if (kots.length === 0) {
        throw new RestaurantError("No served, unbilled KOTs found for this table", 400);
      }

      const products = await fastify.prisma.product.findMany({
        where: {
          tenantId: request.tenant.id,
          isActive: true,
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));
      const productByName = new Map(products.map((product) => [normalizeRestaurantName(product.name), product]));
      const itemsByProduct = new Map<string, { productId: string; quantity: number; sellingPrice: number }>();

      for (const item of kots.flatMap((kot) => kot.items)) {
        const product = item.productId ? productById.get(item.productId) : productByName.get(normalizeRestaurantName(item.productName));
        if (!product) {
          throw new RestaurantError(`Product "${item.productName}" must be linked before billing this table`, 400);
        }

        const existing = itemsByProduct.get(product.id);
        const quantity = item.quantity.toNumber();
        if (existing) {
          existing.quantity += quantity;
        } else {
          itemsByProduct.set(product.id, {
            productId: product.id,
            quantity,
            sellingPrice: product.sellingPrice.toNumber(),
          });
        }
      }

      const invoiceItems = [...itemsByProduct.values()].filter((item) => item.quantity > 0);
      if (invoiceItems.length === 0) {
        throw new RestaurantError("No billable items found for this table", 400);
      }

      const customerIds = [...new Set(kots.flatMap((kot) => kot.customerId ? [kot.customerId] : []))];
      const invoice = await billingService.createInvoice(request.tenant, {
        ...(customerIds.length === 1 ? { customerId: customerIds[0] } : {}),
        paymentMode: PaymentMode.CASH,
        billDiscount: 0,
        notes: `Restaurant table ${table.number} bill from ${kots.length} KOT(s).`,
        verticalData: {
          source: "RESTAURANT_KOT",
          tableId,
          tableNumber: table.number,
          kotIds: kots.map((kot) => kot.id),
          kotNumbers: kots.map((kot) => kot.kotNumber),
        },
        items: invoiceItems,
      });

      await fastify.prisma.$transaction([
        fastify.prisma.kOT.updateMany({
          where: {
            tenantId: request.tenant.id,
            id: {
              in: kots.map((kot) => kot.id),
            },
          },
          data: {
            invoiceId: invoice.id,
            billedAt: new Date(),
          },
        }),
        fastify.prisma.restaurantTable.updateMany({
          where: {
            id: tableId,
            tenantId: request.tenant.id,
            status: "OCCUPIED",
          },
          data: {
            status: "CLEANING",
          },
        }),
        fastify.prisma.auditLog.create({
          data: {
            tenantId: request.tenant.id,
            userId: request.user.userId,
            action: "RESTAURANT_TABLE_BILLED",
            entity: "INVOICE",
            entityId: invoice.id,
            changes: {
              tableId,
              kotIds: kots.map((kot) => kot.id),
              invoiceNumber: invoice.invoiceNumber,
            },
            ip: request.ip,
          },
        }),
      ]);

      return invoice;
    });
  });

  // ---- KOT ----
  fastify.get("/api/restaurant/kots", async (request) => {
    const { status } = z.object({ status: z.string().optional() }).parse(request.query);
    return fastify.prisma.kOT.findMany({
      where: { tenantId: request.tenant.id, ...(status ? { status: status as "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED" } : {}) },
      include: { items: true, table: true, customer: true },
      orderBy: { createdAt: "desc" },
    });
  });

  fastify.get("/api/restaurant/kds/live", async (request, reply) => {
    const sendSnapshot = async () => {
      const payload = await buildKdsPayload(fastify, request.tenant.id);
      reply.raw.write(`event: kds\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    await sendSnapshot();
    const timer = setInterval(() => {
      void sendSnapshot().catch((error: unknown) => {
        request.log.error({ error }, "KDS SSE snapshot failed");
      });
    }, 5000);

    request.raw.on("close", () => {
      clearInterval(timer);
    });
  });

  fastify.post("/api/restaurant/kots", async (request) => {
    const input = createKotSchema.parse(request.body);
    const now = new Date().toISOString().slice(0, 10).replaceAll("-", "");

    const counter = await fastify.prisma.$transaction(async (tx) => {
      const rec = await tx.invoiceCounter.upsert({
        where: { tenantId_date: { tenantId: request.tenant.id, date: `KOT-${now}` } },
        create: { tenantId: request.tenant.id, date: `KOT-${now}`, nextSeq: 2 },
        update: { nextSeq: { increment: 1 } },
      });
      return `KOT-${now}-${String(rec.nextSeq - 1).padStart(4, "0")}`;
    });

    const kot = await fastify.prisma.kOT.create({
      data: {
        tenantId: request.tenant.id,
        kotNumber: counter,
        createdBy: request.user.userId,
        ...(input.tableId ? { tableId: input.tableId } : {}),
        ...(input.customerId ? { customerId: input.customerId } : {}),
        items: {
          createMany: {
            data: input.items.map((item) => ({
            tenantId: request.tenant.id,
            productId: item.productId ?? null,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
            notes: item.notes ?? null,
            modifiers: item.modifiers ?? Prisma.JsonNull,
          })),
          },
        },
      },
      include: { items: true, table: true },
    });

    // Mark table as occupied
    if (input.tableId) {
      await fastify.prisma.restaurantTable.updateMany({
        where: { id: input.tableId, tenantId: request.tenant.id },
        data: { status: "OCCUPIED" },
      });
    }

    return kot;
  });

  fastify.put("/api/restaurant/kots/:id/status", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const { status } = z.object({ status: z.enum(["PENDING", "PREPARING", "READY", "SERVED", "CANCELLED"]) }).parse(request.body);

      const kot = await fastify.prisma.kOT.findFirst({ where: { id, tenantId: request.tenant.id } });
      if (!kot) throw new RestaurantError("KOT not found", 404);

      await fastify.prisma.kOT.update({ where: { id }, data: { status } });

      // Free table when served
      if (status === "SERVED" && kot.tableId) {
        const remaining = await fastify.prisma.kOT.count({
          where: { tableId: kot.tableId, tenantId: request.tenant.id, status: { notIn: ["SERVED", "CANCELLED"] }, id: { not: id } },
        });
        if (remaining === 0) {
          await fastify.prisma.restaurantTable.update({ where: { id: kot.tableId }, data: { status: "CLEANING" } });
        }
      }

      return { status: "ok" };
    });
  });

  fastify.post("/api/restaurant/kots/:id/bump", async (request, reply) => {
    return handleError(reply, async () => {
      const { id } = kotIdParamsSchema.parse(request.params);
      const kot = await fastify.prisma.kOT.findFirst({
        where: {
          id,
          tenantId: request.tenant.id,
        },
      });
      if (!kot) {
        throw new RestaurantError("KOT not found", 404);
      }
      if (kot.status !== "PREPARING") {
        throw new RestaurantError("Only preparing KOTs can be bumped to ready", 400);
      }

      await fastify.prisma.kOT.update({
        where: { id },
        data: { status: "READY" },
      });
      await fastify.prisma.auditLog.create({
        data: {
          tenantId: request.tenant.id,
          userId: request.user.userId,
          action: "KOT_BUMPED_READY",
          entity: "KOT",
          entityId: id,
          changes: { previousStatus: kot.status, nextStatus: "READY" },
          ip: request.ip,
        },
      });

      return { status: "ok" };
    });
  });

  // ---- MENU CATEGORIES ----
  fastify.get("/api/restaurant/menu-categories", async (request) => {
    return fastify.prisma.menuCategory.findMany({
      where: { tenantId: request.tenant.id, isActive: true },
      include: { products: { where: { isActive: true }, take: 50 } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });

  fastify.post("/api/restaurant/menu-categories", async (request) => {
    const input = menuCategorySchema.parse(request.body);
    return fastify.prisma.menuCategory.create({ data: { tenantId: request.tenant.id, ...input } });
  });

  fastify.delete("/api/restaurant/menu-categories/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await fastify.prisma.menuCategory.updateMany({ where: { id, tenantId: request.tenant.id }, data: { isActive: false } });
    if (result.count === 0) return reply.status(404).send({ error: "Menu category not found" });
    return { status: "ok" };
  });

  // ---- MODIFIER GROUPS ----
  fastify.get("/api/restaurant/modifier-groups", async (request) => {
    return fastify.prisma.menuModifierGroup.findMany({
      where: { tenantId: request.tenant.id },
      include: { options: true },
      orderBy: { name: "asc" },
    });
  });

  fastify.post("/api/restaurant/modifier-groups", async (request) => {
    const input = modifierGroupSchema.parse(request.body);
    return fastify.prisma.menuModifierGroup.create({
      data: {
        tenantId: request.tenant.id,
        name: input.name,
        required: input.required,
        multiSelect: input.multiSelect,
        options: {
          create: input.options.map((option) => ({
            tenantId: request.tenant.id,
            name: option.name,
            extraPrice: option.extraPrice,
          })),
        },
      },
      include: { options: true },
    });
  });

  // ---- RECIPES ----
  fastify.get("/api/restaurant/recipes/:productId", async (request) => {
    const { productId } = z.object({ productId: z.string().min(1) }).parse(request.params);
    return fastify.prisma.recipe.findMany({
      where: { tenantId: request.tenant.id, productId },
      include: { ingredient: true },
    });
  });

  fastify.put("/api/restaurant/recipes/:productId", async (request) => {
    const { productId } = z.object({ productId: z.string().min(1) }).parse(request.params);
    const { items } = z.object({ items: z.array(recipeItemSchema) }).parse(request.body);

    await fastify.prisma.$transaction(async (tx) => {
      await tx.recipe.deleteMany({ where: { tenantId: request.tenant.id, productId } });
      if (items.length > 0) {
        await tx.recipe.createMany({
          data: items.map((item) => ({
            tenantId: request.tenant.id,
            productId,
            ingredientProductId: item.ingredientProductId,
            quantity: item.quantity,
            unit: item.unit,
          })),
        });
      }
    });

    return fastify.prisma.recipe.findMany({ where: { tenantId: request.tenant.id, productId }, include: { ingredient: true } });
  });

  done();
};

async function handleError<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try { return await handler(); }
  catch (error) {
    if (error instanceof RestaurantError) return reply.status(error.statusCode).send({ error: error.message });
    throw error;
  }
}

function normalizeRestaurantName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").replace(/\s+/g, " ").trim();
}

async function buildKdsPayload(fastify: FastifyInstance, tenantId: string) {
  const now = Date.now();
  const kots = await fastify.prisma.kOT.findMany({
    where: {
      tenantId,
      status: {
        in: ["PENDING", "PREPARING"],
      },
    },
    include: {
      items: true,
      table: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return kots.map((kot) => ({
    id: kot.id,
    kotNumber: kot.kotNumber,
    tableNumber: kot.table?.number ?? "Takeaway",
    status: kot.status,
    createdAt: kot.createdAt.toISOString(),
    elapsedMinutes: Math.max(0, Math.floor((now - kot.createdAt.getTime()) / 60_000)),
    items: kot.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity.toNumber(),
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      notes: item.notes,
    })),
  }));
}
