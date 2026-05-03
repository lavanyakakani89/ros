import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { FastifyPluginCallback, FastifyReply } from "fastify";

export class RestaurantError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const tableSchema = z.object({
  number: z.string().min(1),
  capacity: z.coerce.number().int().positive().default(4),
  section: z.string().optional(),
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
  // ---- TABLES ----
  fastify.get("/api/restaurant/tables", async (request) => {
    const { status } = z.object({ status: z.string().optional() }).parse(request.query);
    return fastify.prisma.restaurantTable.findMany({
      where: { tenantId: request.tenant.id, ...(status ? { status: status as "AVAILABLE" | "OCCUPIED" | "RESERVED" | "CLEANING" } : {}) },
      include: { kots: { where: { status: { notIn: ["SERVED", "CANCELLED"] } } } },
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

  // ---- KOT ----
  fastify.get("/api/restaurant/kots", async (request) => {
    const { status } = z.object({ status: z.string().optional() }).parse(request.query);
    return fastify.prisma.kOT.findMany({
      where: { tenantId: request.tenant.id, ...(status ? { status: status as "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED" } : {}) },
      include: { items: true, table: true, customer: true },
      orderBy: { createdAt: "desc" },
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
