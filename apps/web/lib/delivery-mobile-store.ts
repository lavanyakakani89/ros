import Dexie, { type Table } from "dexie";

export type MobileDeliveryStatus = "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";

export interface MobileDeliveryCacheRecord {
  id: string;
  payload: unknown;
  syncedAt: Date;
}

export interface PendingDeliveryStatusUpdate {
  id?: number;
  deliveryId: string;
  status: MobileDeliveryStatus;
  notes?: string;
  clientUpdatedAt: Date;
}

export interface PendingLocationPing {
  id?: number;
  deliveryId?: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  batteryPct?: number;
  capturedAt: Date;
}

class DeliveryMobileDB extends Dexie {
  deliveries!: Table<MobileDeliveryCacheRecord, string>;
  statusUpdates!: Table<PendingDeliveryStatusUpdate, number>;
  locationPings!: Table<PendingLocationPing, number>;

  constructor() {
    super("RetailOS-Delivery-Mobile");
    this.version(1).stores({
      deliveries: "id, syncedAt",
      statusUpdates: "++id, deliveryId, status, clientUpdatedAt",
      locationPings: "++id, deliveryId, capturedAt",
    });
  }
}

export const deliveryMobileDB = new DeliveryMobileDB();

export async function cacheMobileDeliveries(deliveries: Array<{ id: string }>) {
  await deliveryMobileDB.transaction("rw", deliveryMobileDB.deliveries, async () => {
    await deliveryMobileDB.deliveries.clear();
    await deliveryMobileDB.deliveries.bulkPut(deliveries.map((delivery) => ({
      id: delivery.id,
      payload: delivery,
      syncedAt: new Date(),
    })));
  });
}

export async function readCachedMobileDeliveries<T>(): Promise<T[]> {
  const rows = await deliveryMobileDB.deliveries.orderBy("syncedAt").reverse().toArray();
  return rows.map((row) => row.payload as T);
}

export async function queueDeliveryStatusUpdate(input: Omit<PendingDeliveryStatusUpdate, "clientUpdatedAt">) {
  await deliveryMobileDB.statusUpdates.add({
    ...input,
    clientUpdatedAt: new Date(),
  });
}

export async function queueLocationPing(input: PendingLocationPing) {
  await deliveryMobileDB.locationPings.add(input);
}

export async function getDeliveryQueueCounts() {
  const [statusUpdates, locationPings] = await Promise.all([
    deliveryMobileDB.statusUpdates.count(),
    deliveryMobileDB.locationPings.count(),
  ]);

  return {
    statusUpdates,
    locationPings,
  };
}

export async function flushDeliveryQueues(apiClient: {
  post<T = unknown>(path: string, payload: object): Promise<T>;
}) {
  const [statusUpdates, locationPings] = await Promise.all([
    deliveryMobileDB.statusUpdates.toArray(),
    deliveryMobileDB.locationPings.toArray(),
  ]);

  if (statusUpdates.length === 0 && locationPings.length === 0) {
    return null;
  }

  const result = await apiClient.post("/delivery/mobile/sync", {
    statusUpdates: statusUpdates.map((update) => ({
      deliveryId: update.deliveryId,
      status: update.status,
      ...(update.notes ? { notes: update.notes } : {}),
      clientUpdatedAt: update.clientUpdatedAt,
    })),
    locationPings: locationPings.map((ping) => ({
      ...(ping.deliveryId ? { deliveryId: ping.deliveryId } : {}),
      latitude: ping.latitude,
      longitude: ping.longitude,
      ...(ping.accuracyMeters !== undefined ? { accuracyMeters: ping.accuracyMeters } : {}),
      ...(ping.batteryPct !== undefined ? { batteryPct: ping.batteryPct } : {}),
      capturedAt: ping.capturedAt,
    })),
  });

  await deliveryMobileDB.transaction("rw", deliveryMobileDB.statusUpdates, deliveryMobileDB.locationPings, async () => {
    if (statusUpdates.length > 0) {
      await deliveryMobileDB.statusUpdates.bulkDelete(statusUpdates.map((update) => update.id).filter((id): id is number => id !== undefined));
    }
    if (locationPings.length > 0) {
      await deliveryMobileDB.locationPings.bulkDelete(locationPings.map((ping) => ping.id).filter((id): id is number => id !== undefined));
    }
  });

  return result;
}
