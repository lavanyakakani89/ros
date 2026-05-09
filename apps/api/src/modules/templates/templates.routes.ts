import { PaperSize, Prisma, RenderType } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";

import { buildEscposInvoice, getEffectiveTemplate, type InvoiceForPrint } from "../printer/printer.service.js";

const templateIdParamsSchema = z.object({
  id: z.string().min(1),
});

const cloneParamsSchema = z.object({
  systemId: z.string().min(1),
});

const templateUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(240).optional().nullable(),
  paperSize: z.nativeEnum(PaperSize).optional(),
  renderType: z.nativeEnum(RenderType).optional(),
  htmlSource: z.string().optional().nullable(),
  escposConfig: z.unknown().optional().nullable(),
  uiConfig: z.unknown().optional().nullable(),
});

export const templatesRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/templates", async (request) => {
    const [templates, effectiveTemplate] = await Promise.all([
      fastify.prisma.invoiceTemplate.findMany({
        where: {
          OR: [
            {
              tenantId: null,
            },
            {
              tenantId: request.tenant.id,
            },
          ],
        },
        orderBy: [
          {
            isSystem: "desc",
          },
          {
            paperSize: "asc",
          },
          {
            name: "asc",
          },
        ],
      }),
      getEffectiveTemplate(fastify, request.tenant),
    ]);

    return {
      templates,
      effectiveTemplateId: effectiveTemplate?.id ?? null,
    };
  });

  fastify.post("/api/templates/clone/:systemId", async (request, reply) => {
    const params = cloneParamsSchema.parse(request.params);
    const systemTemplate = await fastify.prisma.invoiceTemplate.findFirst({
      where: {
        id: params.systemId,
        tenantId: null,
        isSystem: true,
      },
    });

    if (!systemTemplate) {
      return reply.status(404).send({ error: "System template not found" });
    }

    const clone = await fastify.prisma.invoiceTemplate.create({
      data: {
        tenantId: request.tenant.id,
        name: `${systemTemplate.name} copy`,
        description: systemTemplate.description,
        paperSize: systemTemplate.paperSize,
        renderType: systemTemplate.renderType,
        htmlSource: systemTemplate.htmlSource,
        escposConfig: jsonForWrite(systemTemplate.escposConfig),
        uiConfig: jsonForWrite(systemTemplate.uiConfig),
        isSystem: false,
        isLocked: false,
        clonedFromId: systemTemplate.id,
      },
    });

    return reply.status(201).send({ template: clone });
  });

  fastify.put("/api/templates/:id", async (request, reply) => {
    const params = templateIdParamsSchema.parse(request.params);
    const input = templateUpdateSchema.parse(request.body);
    const existing = await fastify.prisma.invoiceTemplate.findFirst({
      where: {
        id: params.id,
        tenantId: request.tenant.id,
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Shop template not found" });
    }

    const template = await fastify.prisma.invoiceTemplate.update({
      where: {
        id: params.id,
      },
      data: {
        ...templateUpdateData(input),
        version: {
          increment: 1,
        },
      },
    });

    return { template };
  });

  fastify.delete("/api/templates/:id", async (request, reply) => {
    const params = templateIdParamsSchema.parse(request.params);
    const result = await fastify.prisma.invoiceTemplate.deleteMany({
      where: {
        id: params.id,
        tenantId: request.tenant.id,
        isSystem: false,
      },
    });

    if (result.count === 0) {
      return reply.status(404).send({ error: "Shop template not found" });
    }

    return { status: "deleted" };
  });

  fastify.post("/api/templates/:id/set-default", async (request, reply) => {
    const params = templateIdParamsSchema.parse(request.params);
    const template = await fastify.prisma.invoiceTemplate.findFirst({
      where: {
        id: params.id,
        OR: [
          {
            tenantId: request.tenant.id,
          },
          {
            tenantId: null,
            isSystem: true,
          },
        ],
      },
    });

    if (!template) {
      return reply.status(404).send({ error: "Template not found" });
    }

    const activeTemplate = await fastify.prisma.$transaction(async (tx) => {
      let shopTemplate = template;

      if (template.tenantId === null) {
        shopTemplate = await tx.invoiceTemplate.findFirst({
          where: {
            tenantId: request.tenant.id,
            clonedFromId: template.id,
          },
        }) ?? await tx.invoiceTemplate.create({
          data: {
            tenantId: request.tenant.id,
            name: `${template.name} active`,
            description: template.description,
            paperSize: template.paperSize,
            renderType: template.renderType,
            htmlSource: template.htmlSource,
            escposConfig: jsonForWrite(template.escposConfig),
            uiConfig: jsonForWrite(template.uiConfig),
            isSystem: false,
            isLocked: false,
            clonedFromId: template.id,
          },
        });
      }

      await tx.invoiceTemplate.updateMany({
        where: {
          tenantId: request.tenant.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });

      return tx.invoiceTemplate.update({
        where: {
          id: shopTemplate.id,
        },
        data: {
          isDefault: true,
        },
      });
    });

    return { status: "ok", template: activeTemplate };
  });

  fastify.get("/api/templates/:id/preview", async (request, reply) => {
    const params = templateIdParamsSchema.parse(request.params);
    const template = await fastify.prisma.invoiceTemplate.findFirst({
      where: {
        id: params.id,
        OR: [
          {
            tenantId: null,
          },
          {
            tenantId: request.tenant.id,
          },
        ],
      },
    });

    if (!template) {
      return reply.status(404).send({ error: "Template not found" });
    }

    if (template.renderType === RenderType.ESC_POS) {
      const receipt = buildEscposInvoice(request.tenant, mockInvoiceForPreview(), template);

      return {
        renderType: template.renderType,
        previewText: receipt.text,
        bytesBase64: receipt.bytes.toString("base64"),
      };
    }

    return {
      renderType: template.renderType,
      previewHtml: template.htmlSource ?? defaultPreviewHtml(request.tenant.name),
    };
  });

  done();
};

function defaultPreviewHtml(shopName: string): string {
  return `<!doctype html><html><body><h1>${escapeHtml(shopName)}</h1><p>GST invoice preview</p></body></html>`;
}

function mockInvoiceForPreview(): InvoiceForPrint {
  return {
    id: "preview",
    invoiceNumber: "INV-20260509-0001",
    invoiceDate: new Date("2026-05-09T05:40:12.000Z"),
    paymentMode: "CREDIT",
    subtotal: decimal(900),
    totalDiscount: decimal(0),
    totalCgst: decimal(0),
    totalSgst: decimal(0),
    grandTotal: decimal(900),
    amountPaid: decimal(0),
    amountDue: decimal(900),
    customer: {
      name: "Chakravarthi Aravapalli",
      phone: "91000126",
    },
    items: [
      {
        id: "preview-item",
        tenantId: "preview-tenant",
        invoiceId: "preview",
        productId: "preview-product",
        productName: "White Sesame Oil 1L",
        quantity: decimal(2),
        unit: "UNT",
        mrp: decimal(450),
        sellingPrice: decimal(450),
        discount: decimal(0),
        gstRate: decimal(0),
        cgst: decimal(0),
        sgst: decimal(0),
        total: decimal(900),
        batchNumber: null,
        expiryDate: null,
      },
    ],
  };
}

function decimal(value: number) {
  return {
    toNumber: () => value,
    toString: () => value.toFixed(2),
  } as never;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function templateUpdateData(input: z.infer<typeof templateUpdateSchema>): Prisma.InvoiceTemplateUpdateInput {
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
