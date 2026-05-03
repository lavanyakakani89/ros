import { z } from "zod";
import type { FastifyPluginCallback } from "fastify";

export const auditRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/audit-logs", async (request) => {
    const { page, limit, entity } = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().max(100).default(50),
      entity: z.string().optional(),
    }).parse(request.query);

    const where = { tenantId: request.tenant.id, ...(entity ? { entity } : {}) };
    const [total, data] = await Promise.all([
      fastify.prisma.auditLog.count({ where }),
      fastify.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, page, limit, total };
  });

  done();
};

export async function writeAuditLog(
  prisma: { auditLog: { create: (args: object) => Promise<unknown> } },
  params: { tenantId: string; userId: string; action: string; entity: string; entityId?: string; changes?: unknown; ip?: string },
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      changes: params.changes ?? undefined,
      ip: params.ip ?? null,
    },
  });
}
