import type { DeliveryRoutePlanStatus, DeliveryRouteStopStatus } from "@prisma/client";

export interface CreateDeliveryRoutePlanInput {
  name?: string | undefined;
  deliveryIds: string[];
  driverIds: string[];
  depotName?: string | undefined;
  depotAddress?: string | undefined;
  depotLatitude?: number | undefined;
  depotLongitude?: number | undefined;
  serviceSeconds: number;
  optimize: boolean;
}

export interface UpdateDeliveryLocationInput {
  latitude: number;
  longitude: number;
  address?: string | undefined;
  manuallyVerified?: boolean | undefined;
}

export interface PatchDeliveryRoutePlanInput {
  name?: string | undefined;
  status?: DeliveryRoutePlanStatus | undefined;
}

export interface PatchDeliveryRouteStopInput {
  sequence?: number | undefined;
  status?: DeliveryRouteStopStatus | undefined;
  isLocked?: boolean | undefined;
  notes?: string | undefined;
}

export interface DeliveryRoutePlanParams {
  id: string;
}

export interface DeliveryRouteStopParams {
  id: string;
  stopId: string;
}

export interface DeliveryLocationParams {
  id: string;
}
