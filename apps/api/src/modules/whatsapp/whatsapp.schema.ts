import { WhatsappOrderStatus } from "@prisma/client";
import { z } from "zod";

import { WHATSAPP_TEMPLATE_KEYS } from "./whatsapp.templates.js";

export const whatsappTenantParamsSchema = z.object({
  tenantSlug: z.string().trim().min(1),
});

export const whatsappWebhookQuerySchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
  secret: z.string().optional(),
});

export const whatsappOrdersQuerySchema = z.object({
  status: z.nativeEnum(WhatsappOrderStatus).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const whatsappEmbeddedSignupCompleteSchema = z.object({
  code: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1).optional(),
  wabaId: z.string().trim().min(1).optional(),
  businessId: z.string().trim().min(1).optional(),
  sessionPayload: z.unknown().optional(),
});

export const whatsappTestMessageSchema = z.object({
  phone: z.string().trim().min(10).max(16),
});

export const whatsappPasteOrderSchema = z.object({
  phone: z.string().trim().min(10).max(16),
  customerName: z.string().trim().min(2).max(120).optional(),
  body: z.string().trim().min(3).max(5000),
});

export const whatsappMessageTemplatesSchema = z.object({
  templates: z.array(z.object({
    key: z.enum(WHATSAPP_TEMPLATE_KEYS),
    body: z.string().trim().min(1).max(5000),
  })).min(1).max(WHATSAPP_TEMPLATE_KEYS.length),
});

export type WhatsappOrdersQuery = z.infer<typeof whatsappOrdersQuerySchema>;
export type WhatsappEmbeddedSignupCompleteInput = z.infer<typeof whatsappEmbeddedSignupCompleteSchema>;
export type WhatsappTestMessageInput = z.infer<typeof whatsappTestMessageSchema>;
export type WhatsappPasteOrderInput = z.infer<typeof whatsappPasteOrderSchema>;
export type WhatsappMessageTemplatesInput = z.infer<typeof whatsappMessageTemplatesSchema>;
