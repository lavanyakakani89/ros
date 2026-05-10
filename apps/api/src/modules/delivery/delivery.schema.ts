import { DeliveryProofType, DeliveryStatus } from "@prisma/client";
import { z } from "zod";

export const createDeliverySchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  deliveryAddress: z.string().trim().min(5),
  latitude: z.coerce.number().finite().optional(),
  longitude: z.coerce.number().finite().optional(),
  scheduledAt: z.coerce.date().optional(),
  timeWindowStart: z.coerce.date().optional(),
  timeWindowEnd: z.coerce.date().optional(),
  priority: z.coerce.number().int().min(0).max(100).optional(),
  weightKg: z.coerce.number().nonnegative().optional(),
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

export const deliveryProofParamsSchema = z.object({
  id: z.string().min(1),
  proofId: z.string().min(1),
});

export const notificationIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const assignDeliverySchema = z.object({
  userId: z.string().min(1),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.nativeEnum(DeliveryStatus),
  notes: z.string().trim().min(1).optional(),
});

export const updateDeliveryLocationSchema = z.object({
  latitude: z.coerce.number().finite(),
  longitude: z.coerce.number().finite(),
});

export const deliveryLocationPingSchema = z.object({
  deliveryId: z.string().min(1).optional(),
  latitude: z.coerce.number().finite(),
  longitude: z.coerce.number().finite(),
  accuracyMeters: z.coerce.number().nonnegative().optional(),
  batteryPct: z.coerce.number().int().min(0).max(100).optional(),
  capturedAt: z.coerce.date().default(() => new Date()),
});

export const deliveryMobileSyncSchema = z.object({
  statusUpdates: z
    .array(z.object({
      deliveryId: z.string().min(1),
      status: z.nativeEnum(DeliveryStatus),
      notes: z.string().trim().min(1).optional(),
      clientUpdatedAt: z.coerce.date().optional(),
    }))
    .default([]),
  locationPings: z.array(deliveryLocationPingSchema).default([]),
});

export const optimizeDeliveryRoutesSchema = z.object({
  deliveryIds: z.array(z.string().min(1)).optional(),
  userIds: z.array(z.string().min(1)).optional(),
  depotLatitude: z.coerce.number().finite().optional(),
  depotLongitude: z.coerce.number().finite().optional(),
  vehicleCapacityKg: z.coerce.number().positive().optional(),
  maxDistanceMeters: z.coerce.number().positive().optional(),
  returnToDepot: z.boolean().default(false),
});

export const createDeliveryProofFieldsSchema = z.object({
  proofType: z.nativeEnum(DeliveryProofType).default(DeliveryProofType.DELIVERY_PHOTO),
  notes: z.string().trim().min(1).optional(),
  latitude: z.coerce.number().finite().optional(),
  longitude: z.coerce.number().finite().optional(),
});
