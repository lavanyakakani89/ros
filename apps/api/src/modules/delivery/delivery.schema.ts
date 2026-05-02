import { DeliveryStatus } from "@prisma/client";
import { z } from "zod";

export const createDeliverySchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  deliveryAddress: z.string().trim().min(5),
  scheduledAt: z.coerce.date().optional(),
  notes: z.string().trim().min(1).optional(),
});

export const deliveryListQuerySchema = z.object({
  status: z.nativeEnum(DeliveryStatus).optional(),
});

export const deliveryIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const deliveryAgentParamsSchema = z.object({
  userId: z.string().min(1),
});

export const assignDeliverySchema = z.object({
  userId: z.string().min(1),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.nativeEnum(DeliveryStatus),
  notes: z.string().trim().min(1).optional(),
});
