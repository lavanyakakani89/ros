import { z } from "zod";
import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { Prisma } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().min(1).optional(),
  sortOrder: z.coerce.number().int().default(0),
});

export const categoriesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/categories", async (request) => {
    return fastify.prisma.category.findMany({
      where: { tenantId: request.tenant.id, isActive: true },
      include: {
        children: true,
        _count: {
          select: { products: true },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });

  fastify.post("/api/categories", async (request) => {
    const input = createSchema.parse(request.body);
    const name = input.name.trim();
    const parentId = input.parentId ?? null;
    const existing = await fastify.prisma.category.findFirst({
      where: { tenantId: request.tenant.id, name },
    });

    if (existing?.isActive) {
      throw new CategoryConflictError(`Category "${name}" already exists.`);
    }

    if (existing) {
      return fastify.prisma.category.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          parentId,
          sortOrder: input.sortOrder,
        },
      });
    }

    const code = await nextCategoryCode(fastify, request.tenant.id, Boolean(input.parentId));
    return fastify.prisma.category.create({
      data: {
        tenantId: request.tenant.id,
        code,
        name,
        sortOrder: input.sortOrder,
        ...(parentId ? { parentId } : {}),
      },
    });
  });

  fastify.put("/api/categories/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const input = createSchema.partial().parse(request.body);
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
    const result = await fastify.prisma.category.updateMany({ where: { id, tenantId: request.tenant.id }, data });
    if (result.count === 0) return reply.status(404).send({ error: "Category not found" });
    return fastify.prisma.category.findFirst({ where: { id } });
  });

  fastify.delete("/api/categories/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const category = await fastify.prisma.category.findFirst({
      where: { id, tenantId: request.tenant.id },
      include: {
        _count: {
          select: {
            children: true,
            products: true,
          },
        },
      },
    });
    if (!category) return reply.status(404).send({ error: "Category not found" });

    if (category._count.children > 0) {
      return reply.status(409).send({ error: "Delete sub-categories first, then delete the parent category." });
    }

    if (category._count.products > 0) {
      return reply.status(409).send({ error: "Move or delete products in this category before deleting it." });
    }

    try {
      await fastify.prisma.category.delete({ where: { id: category.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return reply.status(409).send({ error: "This category is still used by another record." });
      }
      throw error;
    }
    return { status: "ok" };
  });

  done();
};

class CategoryConflictError extends Error {
  statusCode = 409;
}

async function nextCategoryCode(fastify: FastifyInstance, tenantId: string, isSubCategory: boolean): Promise<string> {
  const prefix = isSubCategory ? "SC" : "C";
  const categories = await fastify.prisma.category.findMany({
    where: {
      tenantId,
      code: {
        startsWith: prefix,
      },
      ...(isSubCategory ? { parentId: { not: null } } : { parentId: null }),
    },
    select: { code: true },
  });
  const next = categories.reduce((highest, category) => {
    const suffix = Number(category.code.slice(prefix.length));
    return Number.isFinite(suffix) ? Math.max(highest, suffix) : highest;
  }, 0) + 1;
  return `${prefix}${next.toString().padStart(3, "0")}`;
}
