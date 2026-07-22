import { DeliveryRoutePlanStatus, DeliveryRouteStopStatus } from "@prisma/client";
import { z } from "zod";

export const createDeliveryRoutePlanSchema = z.object({
  name: z.string().trim().min(1).optional(),
  deliveryIds: z.array(z.string().min(1)).min(1),
  driverIds: z.array(z.string().min(1)).min(1),
  depotName: z.string().trim().min(1).optional(),
  depotAddress: z.string().trim().min(1).optional(),
  depotLatitude: z.coerce.number().min(-90).max(90).optional(),
  depotLongitude: z.coerce.number().min(-180).max(180).optional(),
  serviceSeconds: z.coerce.number().int().positive().max(3600).default(Number(process.env.MAPBOX_DEFAULT_SERVICE_SECONDS ?? 300)),
  optimize: z.boolean().default(false),
});

export const patchDeliveryRoutePlanSchema = z.object({
  name: z.string().trim().min(1).optional(),
  status: z.nativeEnum(DeliveryRoutePlanStatus).optional(),
});

export const patchDeliveryRouteStopSchema = z.object({
  sequence: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(DeliveryRouteStopStatus).optional(),
  isLocked: z.boolean().optional(),
  notes: z.string().trim().min(1).optional(),
});

export const deliveryRoutePlanParamsSchema = z.object({
  id: z.string().min(1),
});

export const deliveryRouteStopParamsSchema = z.object({
  id: z.string().min(1),
  stopId: z.string().min(1),
});

export const deliveryLocationParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateDeliveryLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  address: z.string().trim().min(5).optional(),
  manuallyVerified: z.boolean().default(true),
});

export const geocodeBatchSchema = z.object({
  deliveryIds: z.array(z.string().min(1)).min(1).max(100),
});
