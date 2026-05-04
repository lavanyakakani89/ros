"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
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

const fallbackDeliveries: DeliveryItem[] = [];

export function DeliveryBoard() {
  const queryClient = useQueryClient();
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
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeliveryStatus }) => createAuthenticatedApiClient().put(`/delivery/${id}/status`, { status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
  });
  const assignDelivery = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => createAuthenticatedApiClient().post(`/delivery/${id}/assign`, { userId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
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
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
                      <div className="mt-1 text-xs text-slate-500">{delivery.customer?.name ?? "Customer"}</div>
                      <div className="mt-1 text-xs text-slate-500">{delivery.deliveryAddress}</div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">₹{delivery.invoice?.grandTotal ?? "0.00"}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {nextStatuses(delivery.status).map((nextStatus) => (
                          <button
                            key={nextStatus}
                            className="h-8 rounded-md border border-border px-2 text-xs font-medium text-slate-700"
                            onClick={() => updateStatus.mutate({ id: delivery.id, status: nextStatus })}
                          >
                            {nextStatus.replaceAll("_", " ")}
                          </button>
                        ))}
                      </div>
                      <form className="mt-2 flex gap-2" onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        assignDelivery.mutate({ id: delivery.id, userId: formString(form, "userId") });
                      }}>
                        <input name="userId" placeholder="Delivery user ID" className="h-8 min-w-0 flex-1 rounded-md border border-border px-2 text-xs" />
                        <button className="h-8 rounded-md bg-slate-900 px-2 text-xs font-medium text-white">Assign</button>
                      </form>
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

function nextStatuses(status: DeliveryStatus): DeliveryStatus[] {
  if (status === "PENDING") {
    return ["ASSIGNED", "OUT_FOR_DELIVERY", "CANCELLED"];
  }

  if (status === "ASSIGNED") {
    return ["OUT_FOR_DELIVERY", "FAILED", "CANCELLED"];
  }

  if (status === "OUT_FOR_DELIVERY") {
    return ["DELIVERED", "FAILED"];
  }

  return [];
}
