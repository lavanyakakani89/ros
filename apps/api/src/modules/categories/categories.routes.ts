import { z } from "zod";
import type { FastifyPluginCallback } from "fastify";

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
    return fastify.prisma.category.create({
      data: {
        tenantId: request.tenant.id,
        name: input.name,
        sortOrder: input.sortOrder,
        ...(input.parentId ? { parentId: input.parentId } : {}),
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
    const result = await fastify.prisma.category.updateMany({ where: { id, tenantId: request.tenant.id }, data: { isActive: false } });
    if (result.count === 0) return reply.status(404).send({ error: "Category not found" });
    return { status: "ok" };
  });

  done();
};
