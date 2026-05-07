import { WhatsappOrderStatus } from "@prisma/client";
import { z } from "zod";

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

export type WhatsappOrdersQuery = z.infer<typeof whatsappOrdersQuerySchema>;
