import Dexie, { type Table } from "dexie";

export interface PendingInvoice {
  id: string;
  tenantId: string;
  payload: object;
  createdAt: Date;
  syncStatus: "pending" | "syncing" | "failed";
  retryCount: number;
}

class OfflineDB extends Dexie {
  pendingInvoices!: Table<PendingInvoice, string>;

  constructor() {
    super("RetailOS-Offline");
    this.version(1).stores({
      pendingInvoices: "id, tenantId, syncStatus, createdAt",
    });
  }
}

export const offlineDB = new OfflineDB();

export async function queueInvoice(payload: object, tenantId: string) {
  await offlineDB.pendingInvoices.add({
    id: crypto.randomUUID(),
    tenantId,
    payload,
    createdAt: new Date(),
    syncStatus: "pending",
    retryCount: 0,
  });
}

export async function getPendingInvoiceCounts() {
  const [pending, syncing, failed] = await Promise.all([
    offlineDB.pendingInvoices.where("syncStatus").equals("pending").count(),
    offlineDB.pendingInvoices.where("syncStatus").equals("syncing").count(),
    offlineDB.pendingInvoices.where("syncStatus").equals("failed").count(),
  ]);

  return { pending, syncing, failed };
}

export async function syncPendingInvoices(apiClient: { post: (path: string, payload: object) => Promise<unknown> }) {
  const pending = await offlineDB.pendingInvoices.where("syncStatus").equals("pending").toArray();

  for (const invoice of pending) {
    try {
      await offlineDB.pendingInvoices.update(invoice.id, { syncStatus: "syncing" });
      await apiClient.post("/billing/invoices", invoice.payload);
      await offlineDB.pendingInvoices.delete(invoice.id);
    } catch {
      await offlineDB.pendingInvoices.update(invoice.id, {
        syncStatus: invoice.retryCount >= 3 ? "failed" : "pending",
        retryCount: invoice.retryCount + 1,
      });
    }
  }
}
