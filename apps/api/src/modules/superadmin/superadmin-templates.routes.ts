import { PaperSize, Prisma, RenderType, SuperAdminRole } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";

import { requireRole, requireSuperAdmin } from "./superadmin-auth.routes.js";

const templateIdParamsSchema = z.object({
  id: z.string().min(1),
});

const pushParamsSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
});

const systemTemplateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).optional().nullable(),
  paperSize: z.nativeEnum(PaperSize),
  renderType: z.nativeEnum(RenderType),
  htmlSource: z.string().optional().nullable(),
  escposConfig: z.unknown().optional().nullable(),
  uiConfig: z.unknown().optional().nullable(),
});
const systemTemplateUpdateSchema = systemTemplateSchema.partial();

export const superAdminTemplatesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/superadmin/templates", { preHandler: requireSuperAdmin }, async () => {
    const templates = await fastify.prisma.invoiceTemplate.findMany({
      where: {
        tenantId: null,
        isSystem: true,
      },
      orderBy: [
        {
          paperSize: "asc",
        },
        {
          name: "asc",
        },
      ],
    });

    return { templates };
  });

  fastify.post(
    "/api/superadmin/templates",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const input = systemTemplateSchema.parse(request.body);
      const template = await fastify.prisma.invoiceTemplate.create({
        data: {
          tenantId: null,
          name: input.name,
          description: input.description ?? null,
          paperSize: input.paperSize,
          renderType: input.renderType,
          htmlSource: input.htmlSource ?? null,
          escposConfig: jsonForWrite(input.escposConfig),
          uiConfig: jsonForWrite(input.uiConfig),
          isSystem: true,
          isLocked: true,
        },
      });

      return reply.status(201).send({ template });
    },
  );

  fastify.put(
    "/api/superadmin/templates/:id",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const params = templateIdParamsSchema.parse(request.params);
      const input = systemTemplateUpdateSchema.parse(request.body);
      const result = await fastify.prisma.invoiceTemplate.updateMany({
        where: {
          id: params.id,
          tenantId: null,
          isSystem: true,
        },
        data: {
          ...systemTemplateUpdateData(input),
          version: {
            increment: 1,
          },
        },
      });

      if (result.count === 0) {
        return reply.status(404).send({ error: "System template not found" });
      }

      const template = await fastify.prisma.invoiceTemplate.findUniqueOrThrow({
        where: {
          id: params.id,
        },
      });

      return { template };
    },
  );

  fastify.post(
    "/api/superadmin/templates/:id/push/:tenantId",
    { preHandler: requireRole([SuperAdminRole.OWNER, SuperAdminRole.MANAGER]) },
    async (request, reply) => {
      const params = pushParamsSchema.parse(request.params);
      const [systemTemplate, tenant] = await Promise.all([
        fastify.prisma.invoiceTemplate.findFirst({
          where: {
            id: params.id,
            tenantId: null,
            isSystem: true,
          },
        }),
        fastify.prisma.tenant.findUnique({
          where: {
            id: params.tenantId,
          },
          select: {
            id: true,
            slug: true,
          },
        }),
      ]);

      if (!systemTemplate) {
        return reply.status(404).send({ error: "System template not found" });
      }

      if (!tenant) {
        return reply.status(404).send({ error: "Shop not found" });
      }

      const existingClone = await fastify.prisma.invoiceTemplate.findFirst({
        where: {
          tenantId: tenant.id,
          clonedFromId: systemTemplate.id,
        },
      });

      const template = existingClone
        ? await fastify.prisma.invoiceTemplate.update({
            where: {
              id: existingClone.id,
            },
            data: {
              name: existingClone.name,
              description: systemTemplate.description,
              paperSize: systemTemplate.paperSize,
              renderType: systemTemplate.renderType,
              htmlSource: systemTemplate.htmlSource,
              escposConfig: jsonForWrite(systemTemplate.escposConfig),
              uiConfig: jsonForWrite(systemTemplate.uiConfig),
              version: {
                increment: 1,
              },
            },
          })
        : await fastify.prisma.invoiceTemplate.create({
            data: {
              tenantId: tenant.id,
              name: systemTemplate.name,
              description: systemTemplate.description,
              paperSize: systemTemplate.paperSize,
              renderType: systemTemplate.renderType,
              htmlSource: systemTemplate.htmlSource,
              escposConfig: jsonForWrite(systemTemplate.escposConfig),
              uiConfig: jsonForWrite(systemTemplate.uiConfig),
              clonedFromId: systemTemplate.id,
            },
          });

      return { template };
    },
  );

  done();
};

function systemTemplateUpdateData(input: z.infer<typeof systemTemplateUpdateSchema>): Prisma.InvoiceTemplateUpdateInput {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.paperSize !== undefined ? { paperSize: input.paperSize } : {}),
    ...(input.renderType !== undefined ? { renderType: input.renderType } : {}),
    ...(input.htmlSource !== undefined ? { htmlSource: input.htmlSource } : {}),
    ...(input.escposConfig !== undefined ? { escposConfig: jsonForWrite(input.escposConfig) } : {}),
    ...(input.uiConfig !== undefined ? { uiConfig: jsonForWrite(input.uiConfig) } : {}),
  };
}

function jsonForWrite(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : value;
}
