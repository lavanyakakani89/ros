import type { DeliveryStatus } from "@prisma/client";

export interface CreateDeliveryInput {
  invoiceId: string;
  customerId: string;
  deliveryAddress: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  scheduledAt?: Date | undefined;
  timeWindowStart?: Date | undefined;
  timeWindowEnd?: Date | undefined;
  priority?: number | undefined;
  weightKg?: number | undefined;
  notes?: string | undefined;
}

export interface DeliveryListQuery {
  status?: DeliveryStatus | undefined;
  scope?: "active" | "archive" | undefined;
  paginated: boolean;
  page: number;
  limit: number;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface DeliveryIdParams {
  id: string;
}

export interface DeliveryAgentParams {
  userId: string;
}

export interface AssignDeliveryInput {
  userId: string;
}

export interface UpdateDeliveryStatusInput {
  status: DeliveryStatus;
  notes?: string | undefined;
}

export interface DeliveryLocationPingInput {
  deliveryId?: string | undefined;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | undefined;
  batteryPct?: number | undefined;
  capturedAt: Date;
}

export interface DeliveryMobileSyncInput {
  statusUpdates: Array<{
    deliveryId: string;
    status: DeliveryStatus;
    notes?: string | undefined;
    clientUpdatedAt?: Date | undefined;
  }>;
  locationPings: DeliveryLocationPingInput[];
}

export interface UpdateDeliveryLocationInput {
  latitude: number;
  longitude: number;
}

export interface OptimizeDeliveryRoutesInput {
  deliveryIds?: string[] | undefined;
  userIds?: string[] | undefined;
  depotLatitude?: number | undefined;
  depotLongitude?: number | undefined;
  vehicleCapacityKg?: number | undefined;
  maxDistanceMeters?: number | undefined;
  returnToDepot: boolean;
}
