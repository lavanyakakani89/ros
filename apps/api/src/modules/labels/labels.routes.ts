import { randomUUID } from "node:crypto";

import { PrinterConn } from "@prisma/client";
import type { FastifyPluginCallback } from "fastify";
import type { z } from "zod";

import { DEFAULT_LABEL_TEMPLATES } from "./labels.defaults.js";
import { LabelsRepository } from "./labels.repository.js";
import {
  labelImageQuerySchema,
  labelPrintSchema,
  labelPreviewSchema,
  labelTemplateCreateSchema,
  labelTemplateParamsSchema,
} from "./labels.schema.js";
import { printLabelBitmaps, renderLabelPdfBuffer, renderLabelSheetBitmaps, resolveLabelJob } from "./labels.renderer.js";
import type { LabelTemplateRecord } from "./labels.types.js";

const labelTemplateUpdateSchema = labelTemplateCreateSchema.partial();

class LabelsError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "LabelsError";
  }
}

interface LabelTemplateView {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  layout_mode: "1up" | "2up";
  canvas_json: NonNullable<z.infer<typeof labelPreviewSchema>["canvas_json"]>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: { id: string; name: string; email: string } | null;
}

interface ResolvedTemplate {
  id: string | null;
  name: string;
  widthMm: number;
  heightMm: number;
  layoutMode: "1up" | "2up";
  canvasJson: NonNullable<z.infer<typeof labelPreviewSchema>["canvas_json"]>;
  isDefault: boolean;
}

export const labelsRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const repository = new LabelsRepository(fastify.prisma);

  fastify.get("/api/labels/templates", async (request) => {
    const templates = await repository.listTemplates(request.tenant.id);
    return {
      templates: [
        ...DEFAULT_LABEL_TEMPLATES.map((template) => serializeDefaultTemplate(template)),
        ...templates.map((template) => serializeDbTemplate(template)),
      ],
    };
  });

  fastify.get("/api/labels/templates/default", () => {
    return {
      templates: DEFAULT_LABEL_TEMPLATES.map((template) => serializeDefaultTemplate(template)),
    };
  });

  fastify.post("/api/labels/templates", async (request, reply) => {
    const input = labelTemplateCreateSchema.parse(request.body);
    const template = await repository.createTemplate(request.tenant.id, request.user.userId, input);

    return reply.status(201).send({
      template: serializeDbTemplate(template),
    });
  });

  fastify.patch("/api/labels/templates/:id", async (request, reply) => {
    const params = labelTemplateParamsSchema.parse(request.params);
    const input = labelTemplateUpdateSchema.parse(request.body);
    const existing = await repository.getTemplate(request.tenant.id, params.id);
    if (!existing || isBuiltInTemplate(existing.id)) {
      return reply.status(404).send({ error: "Label template not found" });
    }

    await repository.updateTemplate(request.tenant.id, params.id, input);
    const updated = await repository.getTemplate(request.tenant.id, params.id);
    return {
      template: updated ? serializeDbTemplate(updated) : null,
    };
  });

  fastify.delete("/api/labels/templates/:id", async (request, reply) => {
    const params = labelTemplateParamsSchema.parse(request.params);
    const existing = await repository.getTemplate(request.tenant.id, params.id);
    if (!existing || isBuiltInTemplate(existing.id)) {
      return reply.status(404).send({ error: "Label template not found" });
    }

    await repository.softDeleteTemplate(request.tenant.id, params.id);
    return reply.status(204).send();
  });

  fastify.post("/api/labels/upload-image", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "Upload an image file." });
    }

    const tenantFolder = `labels/${request.tenant.id}`;
    const extension = extensionForFile(file.filename, file.mimetype);
    const objectName = `${tenantFolder}/${randomUUID()}.${extension}`;
    const buffer = await file.toBuffer();

    await fastify.minio.putObject(fastify.minioBucket, objectName, buffer, buffer.length, {
      "Content-Type": file.mimetype || "image/png",
    });

    return {
      objectName,
      url: `/api/labels/images?objectName=${encodeURIComponent(objectName)}`,
      contentType: file.mimetype || "image/png",
      size: buffer.length,
    };
  });

  fastify.get("/api/labels/images", async (request, reply) => {
    const query = labelImageQuerySchema.parse(request.query);
    if (!query.objectName.startsWith(`labels/${request.tenant.id}/`)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const stat = await fastify.minio.statObject(fastify.minioBucket, query.objectName);
    const stream = await fastify.minio.getObject(fastify.minioBucket, query.objectName);
    reply.header("Content-Type", stat.metaData["content-type"] ?? "application/octet-stream");
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(stream);
  });

  fastify.post("/api/labels/preview", async (request) => {
    const preview = await resolveLabelRequest(fastify, request.tenant.id, labelPreviewSchema.parse(request.body));
    return {
      preview,
    };
  });

  fastify.post("/api/labels/print", async (request, reply) => {
    const input = labelPrintSchema.parse(request.body);
    const preview = await resolveLabelRequest(fastify, request.tenant.id, input);
    const job = await repository.createPrintJob({
      tenantId: request.tenant.id,
      templateId: preview.templateId,
      printedById: request.user.userId,
      items: input.items,
      totalLabels: preview.totalLabels,
      outputType: input.output_type,
    });

    const printer = await fastify.prisma.printerConfig.findUnique({
      where: {
        tenantId: request.tenant.id,
      },
    });

    if (input.output_type === "pdf") {
      const pdf = await renderLabelPdfBuffer(preview);
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", `attachment; filename="label-job-${job.id}.pdf"`);
      return reply.send(pdf);
    }

    const bitmaps = await renderLabelSheetBitmaps(preview);
    await printLabelBitmaps(bitmaps);

    return {
      job: {
        id: job.id,
        templateId: job.templateId,
        totalLabels: job.totalLabels,
        outputType: job.outputType,
        printedAt: job.printedAt,
      },
      printer: {
        connected: Boolean(printer?.isActive && printer.connectionType !== PrinterConn.NONE),
        name: null,
        printer,
      },
      preview,
    };
  });

  fastify.get("/api/labels/printer-status", async (request) => {
    const printer = await fastify.prisma.printerConfig.findUnique({
      where: {
        tenantId: request.tenant.id,
      },
    });

    return {
      connected: Boolean(printer?.isActive && printer.connectionType !== PrinterConn.NONE),
      name: printer?.localPrinterName ?? null,
      printer,
    };
  });

  done();
};

async function resolveLabelRequest(
  fastify: Parameters<typeof resolveLabelJob>[0]["fastify"],
  tenantId: string,
  input: z.infer<typeof labelPreviewSchema>,
) {
  const selectedTemplate = await resolveTemplate(
    fastify,
    tenantId,
    input.template_id,
    input.canvas_json,
    input.width_mm ?? null,
    input.height_mm ?? null,
    input.layout_mode ?? null,
  );

  return resolveLabelJob({
    fastify,
    tenant: { id: tenantId } as Parameters<typeof resolveLabelJob>[0]["tenant"],
    templateId: selectedTemplate.id,
    templateName: selectedTemplate.name,
    canvasJson: selectedTemplate.canvasJson,
    widthMm: selectedTemplate.widthMm,
    heightMm: selectedTemplate.heightMm,
    layoutMode: selectedTemplate.layoutMode,
    items: input.items,
  });
}

async function resolveTemplate(
  fastify: Parameters<typeof resolveLabelJob>[0]["fastify"],
  tenantId: string,
  templateId: string | undefined,
  fallbackCanvas: z.infer<typeof labelPreviewSchema>["canvas_json"],
  fallbackWidthMm: number | null,
  fallbackHeightMm: number | null,
  fallbackLayoutMode: "1up" | "2up" | null,
) {
  if (templateId) {
    const builtIn = DEFAULT_LABEL_TEMPLATES.find((template) => template.id === templateId);
    if (builtIn) {
      return resolveBuiltInTemplate(builtIn);
    }

    const template = await fastify.prisma.labelTemplate.findFirst({
      where: {
        id: templateId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!template) {
      throw new LabelsError(404, "Label template not found.");
    }

    return resolveDbTemplate(template);
  }

  if (!fallbackCanvas) {
    throw new LabelsError(400, "Template canvas is required.");
  }

  return {
    id: null,
    name: "Custom label layout",
    widthMm: fallbackWidthMm ?? 0,
    heightMm: fallbackHeightMm ?? 0,
    layoutMode: fallbackLayoutMode ?? "1up",
    canvasJson: fallbackCanvas,
    isDefault: false,
  } satisfies ResolvedTemplate;
}

function serializeDefaultTemplate(template: LabelTemplateRecord): LabelTemplateView {
  return {
    id: template.id,
    name: template.name,
    width_mm: template.width_mm,
    height_mm: template.height_mm,
    layout_mode: template.layout_mode,
    canvas_json: template.canvas_json,
    is_default: template.is_default,
    created_at: template.created_at,
    updated_at: template.updated_at,
    deleted_at: template.deleted_at,
    created_by: template.created_by ?? null,
  };
}

function serializeDbTemplate(template: {
  id: string;
  name: string;
  widthMm: { toNumber(): number } | number | string;
  heightMm: { toNumber(): number } | number | string;
  layoutMode: string;
  canvasJson: unknown;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  createdBy?: { id: string; name: string; email: string } | null;
}): LabelTemplateView {
  return {
    id: template.id,
    name: template.name,
    width_mm: toNumber(template.widthMm),
    height_mm: toNumber(template.heightMm),
    layout_mode: template.layoutMode === "2up" ? "2up" : "1up",
    canvas_json: template.canvasJson as NonNullable<z.infer<typeof labelPreviewSchema>["canvas_json"]>,
    is_default: template.isDefault,
    created_at: template.createdAt.toISOString(),
    updated_at: template.updatedAt.toISOString(),
    deleted_at: template.deletedAt ? template.deletedAt.toISOString() : null,
    created_by: template.createdBy ?? null,
  };
}

function resolveBuiltInTemplate(template: LabelTemplateRecord): ResolvedTemplate {
  return {
    id: template.id,
    name: template.name,
    widthMm: template.width_mm,
    heightMm: template.height_mm,
    layoutMode: template.layout_mode,
    canvasJson: template.canvas_json,
    isDefault: template.is_default,
  };
}

function resolveDbTemplate(template: {
  id: string;
  name: string;
  widthMm: { toNumber(): number } | number | string;
  heightMm: { toNumber(): number } | number | string;
  layoutMode: string;
  canvasJson: unknown;
  isDefault: boolean;
}): ResolvedTemplate {
  return {
    id: template.id,
    name: template.name,
    widthMm: toNumber(template.widthMm),
    heightMm: toNumber(template.heightMm),
    layoutMode: template.layoutMode === "2up" ? "2up" : "1up",
    canvasJson: template.canvasJson as NonNullable<z.infer<typeof labelPreviewSchema>["canvas_json"]>,
    isDefault: template.isDefault,
  };
}

function isBuiltInTemplate(templateId: string): boolean {
  return DEFAULT_LABEL_TEMPLATES.some((template) => template.id === templateId);
}

function extensionForFile(filename: string, mimeType: string): string {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || mimeType === "image/jpeg") {
    return "jpg";
  }
  if (lowerName.endsWith(".webp") || mimeType === "image/webp") {
    return "webp";
  }
  if (lowerName.endsWith(".gif") || mimeType === "image/gif") {
    return "gif";
  }
  return "png";
}

function toNumber(value: { toNumber(): number } | number | string): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value.toNumber();
}
