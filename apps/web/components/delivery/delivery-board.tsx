"use client";

import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { hasStoredAuthSession } from "@/lib/vertical-config";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";

interface DeliveryItem {
  id: string;
  status: DeliveryStatus;
  deliveryAddress: string;
  assignedTo?: string | null;
  invoice?: {
    invoiceNumber: string;
    grandTotal: string;
  };
  customer?: {
    name: string;
    phone: string;
  };
}

const statuses: DeliveryStatus[] = ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"];

const fallbackDeliveries: DeliveryItem[] = [
  {
    id: "demo-1",
    status: "PENDING",
    deliveryAddress: "MG Road, Bengaluru",
    invoice: { invoiceNumber: "INV-20260501-0005", grandTotal: "302.40" },
    customer: { name: "Walk-in customer", phone: "9000000000" },
  },
];

export function DeliveryBoard() {
  const hasSession = typeof window !== "undefined" && hasStoredAuthSession();
  const deliveriesQuery = useQuery({
    queryKey: ["deliveries"],
    queryFn: async () => {
      if (!hasSession) {
        return fallbackDeliveries;
      }

      return createAuthenticatedApiClient().get<DeliveryItem[]>("/delivery");
    },
    staleTime: 30_000,
  });

  const deliveries = deliveriesQuery.data ?? fallbackDeliveries;

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {statuses.map((status) => {
        const items = deliveries.filter((delivery) => delivery.status === status);

        return (
          <section key={status} className="rounded-md border border-border bg-white">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="text-xs font-semibold text-slate-500">{status.replaceAll("_", " ")}</div>
              <div className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{items.length}</div>
            </div>
            <div className="space-y-2 p-3">
              {items.map((delivery) => (
                <article key={delivery.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <Truck className="mt-0.5 size-4 text-emerald-700" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
                      <div className="mt-1 text-xs text-slate-500">{delivery.customer?.name ?? "Customer"}</div>
                      <div className="mt-1 text-xs text-slate-500">{delivery.deliveryAddress}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">₹{delivery.invoice?.grandTotal ?? "0.00"}</div>
                    </div>
                  </div>
                </article>
              ))}
              {items.length === 0 ? <div className="rounded-md border border-dashed border-slate-200 p-3 text-xs text-slate-400">No deliveries</div> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
