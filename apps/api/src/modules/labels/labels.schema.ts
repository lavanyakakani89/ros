import { z } from "zod";

import { LABEL_FIELD_TYPES, LABEL_LAYOUT_MODES, type LabelCanvasDefinition, type LabelCanvasField } from "./labels.types.js";

const nonNegativeNumber = z.coerce.number().finite().min(0);

export const labelCanvasFieldSchema: z.ZodType<LabelCanvasField> = z.object({
  id: z.string().trim().min(1),
  type: z.enum(LABEL_FIELD_TYPES),
  x: nonNegativeNumber,
  y: nonNegativeNumber,
  width: nonNegativeNumber,
  height: nonNegativeNumber,
  rotation: z.coerce.number().int().min(0).max(359),
  fontSize: z.coerce.number().positive().optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  textContent: z.string().optional(),
  imageUrl: z.string().trim().min(1).optional(),
  codeType: z.enum(["qr", "barcode"]).optional(),
}).strict();

export const labelCanvasSchema: z.ZodType<LabelCanvasDefinition> = z.object({
  fields: z.array(labelCanvasFieldSchema),
}).strict();

export const labelTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  width_mm: nonNegativeNumber.optional(),
  height_mm: nonNegativeNumber.optional(),
  layout_mode: z.enum(LABEL_LAYOUT_MODES).optional(),
  canvas_json: labelCanvasSchema.optional(),
});

export const labelTemplateCreateSchema = labelTemplateBodySchema.extend({
  name: z.string().trim().min(1).max(128),
  width_mm: nonNegativeNumber,
  height_mm: nonNegativeNumber,
  layout_mode: z.enum(LABEL_LAYOUT_MODES),
  canvas_json: labelCanvasSchema,
});

export const labelTemplateParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const labelUploadSchema = z.object({
  // multipart only
});

export const labelSelectionSchema = z.object({
  product_id: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1),
});

const inlinePreviewSchema = z.object({
  template_id: z.string().trim().min(1).optional(),
  canvas_json: labelCanvasSchema.optional(),
  width_mm: nonNegativeNumber.optional(),
  height_mm: nonNegativeNumber.optional(),
  layout_mode: z.enum(LABEL_LAYOUT_MODES).optional(),
});

export const labelPreviewSchema = inlinePreviewSchema.extend({
  items: z.array(labelSelectionSchema).min(1),
}).superRefine((input, context) => {
  if (!input.template_id && !input.canvas_json) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["canvas_json"],
      message: "Template canvas or template_id is required",
    });
  }

  if (!input.template_id) {
    if (input.width_mm === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["width_mm"],
        message: "Label width is required",
      });
    }

    if (input.height_mm === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["height_mm"],
        message: "Label height is required",
      });
    }

    if (!input.layout_mode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout_mode"],
        message: "Layout mode is required",
      });
    }
  }
});

export const labelPrintSchema = labelPreviewSchema.extend({
  output_type: z.enum(["print", "pdf"]),
});

export const labelImageQuerySchema = z.object({
  objectName: z.string().trim().min(1),
});

export type LabelTemplateCreateInput = z.infer<typeof labelTemplateCreateSchema>;
export type LabelTemplateUpdateInput = z.infer<typeof labelTemplateBodySchema>;
export type LabelPreviewInput = z.infer<typeof labelPreviewSchema>;
export type LabelPrintInput = z.infer<typeof labelPrintSchema>;
