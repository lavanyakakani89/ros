import Dexie, { type Table } from "dexie";

export interface PendingInvoice {
  id: string;
  tenantId: string;
  payload: OfflineInvoicePayload;
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

export type OfflineInvoicePayload =
  | object
  | {
      invoice: object;
      delivery?: {
        customerId: string;
        deliveryAddress: string;
        scheduledAt?: string;
        notes?: string;
      };
      autoPay?: {
        mode: string;
      };
    };

export async function queueInvoice(payload: OfflineInvoicePayload, tenantId: string) {
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

export async function syncPendingInvoices(getApiClient: () => Promise<{ post: <T = unknown>(path: string, payload: object) => Promise<T> }>) {
  const pending = await offlineDB.pendingInvoices.where("syncStatus").equals("pending").toArray();

  if (pending.length === 0) {
    return;
  }

  const apiClient = await getApiClient();

  for (const invoice of pending) {
    try {
      await offlineDB.pendingInvoices.update(invoice.id, { syncStatus: "syncing" });
      const envelope = readEnvelope(invoice.payload);
      const created = await apiClient.post<{ id: string; grandTotal?: string | number }>("/billing/invoices", envelope.invoice);
      await apiClient.post(`/billing/invoices/${created.id}/confirm`, {});
      if (envelope.autoPay?.mode && envelope.autoPay.mode !== "CREDIT") {
        await apiClient.post("/payments", {
          invoiceId: created.id,
          amount: Number(created.grandTotal ?? 0),
          mode: envelope.autoPay.mode,
        });
      }
      if (envelope.delivery) {
        await apiClient.post("/delivery", {
          ...envelope.delivery,
          invoiceId: created.id,
        });
      }
      await offlineDB.pendingInvoices.delete(invoice.id);
    } catch {
      await offlineDB.pendingInvoices.update(invoice.id, {
        syncStatus: invoice.retryCount >= 3 ? "failed" : "pending",
        retryCount: invoice.retryCount + 1,
      });
    }
  }
}

function readEnvelope(payload: OfflineInvoicePayload): {
  invoice: object;
  delivery?: {
    customerId: string;
    deliveryAddress: string;
    scheduledAt?: string;
    notes?: string;
  };
  autoPay?: {
    mode: string;
  };
} {
  if (payload && typeof payload === "object" && "invoice" in payload && typeof payload.invoice === "object" && payload.invoice) {
    return payload as {
      invoice: object;
      delivery?: {
        customerId: string;
        deliveryAddress: string;
        scheduledAt?: string;
        notes?: string;
      };
      autoPay?: {
        mode: string;
      };
    };
  }

  return { invoice: payload };
}
