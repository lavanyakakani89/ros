import type { Prisma, PrismaClient } from "@prisma/client";

import type { LabelTemplateCreateInput, LabelTemplateUpdateInput } from "./labels.schema.js";

export class LabelsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listTemplates(tenantId: string) {
    return this.prisma.labelTemplate.findMany({
      where: {
        tenantId,
        deletedAt: null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [
        { isDefault: "desc" },
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
    });
  }

  async getTemplate(tenantId: string, templateId: string) {
    return this.prisma.labelTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async createTemplate(tenantId: string, createdById: string | null, input: LabelTemplateCreateInput) {
    return this.prisma.labelTemplate.create({
      data: {
        tenantId,
        createdById,
        name: input.name,
        widthMm: input.width_mm,
        heightMm: input.height_mm,
        layoutMode: input.layout_mode,
        canvasJson: input.canvas_json,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async updateTemplate(tenantId: string, templateId: string, input: LabelTemplateUpdateInput) {
    return this.prisma.labelTemplate.updateMany({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.width_mm !== undefined ? { widthMm: input.width_mm } : {}),
        ...(input.height_mm !== undefined ? { heightMm: input.height_mm } : {}),
        ...(input.layout_mode !== undefined ? { layoutMode: input.layout_mode } : {}),
        ...(input.canvas_json !== undefined ? { canvasJson: input.canvas_json } : {}),
      },
    });
  }

  async softDeleteTemplate(tenantId: string, templateId: string) {
    return this.prisma.labelTemplate.updateMany({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async listProducts(tenantId: string, productIds: string[]) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        id: { in: productIds },
        isActive: true,
      },
      include: {
        batches: {
          orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
          take: 1,
          select: {
            expiryDate: true,
            receivedAt: true,
          },
        },
      },
    });
  }

  async createPrintJob(input: {
    tenantId: string;
    templateId: string | null;
    printedById: string | null;
    items: Prisma.InputJsonValue;
    totalLabels: number;
    outputType: string;
  }) {
    return this.prisma.labelPrintJob.create({
      data: {
        tenantId: input.tenantId,
        templateId: input.templateId,
        printedById: input.printedById,
        items: input.items,
        totalLabels: input.totalLabels,
        outputType: input.outputType,
      },
    });
  }
}
