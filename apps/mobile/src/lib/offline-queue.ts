import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, type CreateInvoicePayload } from "@bizbil/shared";

import { logger } from "./logger";

const QUEUE_KEY = "bizbil.invoice_queue";

export interface QueuedInvoice {
  id: string;
  payload: CreateInvoicePayload;
  queuedAt: string;
  retryCount: number;
}

type MobileApiClient = typeof import("./api-client").apiClient;

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function queueInvoice(payload: CreateInvoicePayload): Promise<void> {
  const queue = await getQueuedInvoices();
  queue.push({ id: uuid(), payload, queuedAt: new Date().toISOString(), retryCount: 0 });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getQueuedInvoices(): Promise<QueuedInvoice[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedInvoice[];
  } catch {
    return [];
  }
}

export async function syncQueue(apiClient: MobileApiClient): Promise<{ synced: number; failed: number }> {
  const queue = await getQueuedInvoices();
  const remaining: QueuedInvoice[] = [];
  let synced = 0;
  let failed = 0;

  for (const invoice of queue) {
    try {
      await apiClient.post("/api/billing/invoices", invoice.payload);
      synced += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        failed += 1;
        continue;
      }
      const retryCount = invoice.retryCount + 1;
      if (retryCount > 5) {
        failed += 1;
        logger.warn("Dropping permanently failed offline invoice", invoice.id);
      } else {
        remaining.push({ ...invoice, retryCount });
      }
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, failed };
}
