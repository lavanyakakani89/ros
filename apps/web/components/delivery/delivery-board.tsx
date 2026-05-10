"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MessageCircle, Route, Smartphone, Truck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredTenant, hasStoredAuthSession } from "@/lib/vertical-config";
import { formatDeliveryWhatsappMessage, openWhatsappMessage } from "@/lib/whatsapp";

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
  proofs?: Array<{
    id: string;
    proofType: "DELIVERY_PHOTO" | "PAYMENT_SCREENSHOT" | "CUSTOMER_SIGNATURE" | "OTHER";
    fileName: string;
    createdAt: string;
  }>;
}

interface SettingsResponse {
  users: Array<{
    id: string;
    name: string;
    role: string;
    isActive: boolean;
  }>;
}

const statuses: DeliveryStatus[] = ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"];

const fallbackDeliveries: DeliveryItem[] = [];

export function DeliveryBoard() {
  const queryClient = useQueryClient();
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
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
  const usersQuery = useQuery({
    queryKey: ["settings-current", "delivery-users"],
    queryFn: () => createAuthenticatedApiClient().get<SettingsResponse>("/settings/current"),
    enabled: hasSession,
    staleTime: 60_000,
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeliveryStatus }) => createAuthenticatedApiClient().put(`/delivery/${id}/status`, { status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
  });
  const assignDelivery = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => createAuthenticatedApiClient().post(`/delivery/${id}/assign`, { userId }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
  });
  const optimizeRoutes = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<{ provider: string; warnings: string[]; routes: unknown[] }>("/delivery/routes/optimize", {}),
    onSuccess: async (result) => {
      setRouteMessage(`Optimized ${String(result.routes.length)} route(s) using ${result.provider}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
      await queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    },
    onError: (error) => setRouteMessage(error instanceof Error ? error.message : "Route optimization failed."),
  });

  const deliveries = deliveriesQuery.data ?? fallbackDeliveries;
  const deliveryUsers = (usersQuery.data?.users ?? []).filter((user) => user.role === "DELIVERY" && user.isActive);

  function shareDeliveryUpdate(delivery: DeliveryItem) {
    openWhatsappMessage(
      delivery.customer?.phone,
      formatDeliveryWhatsappMessage({
        tenantName: getStoredTenant()?.name ?? "RetailOS",
        customerName: delivery.customer?.name,
        invoiceNumber: delivery.invoice?.invoiceNumber,
        grandTotal: delivery.invoice?.grandTotal,
        status: delivery.status,
        address: delivery.deliveryAddress,
      }),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-100 bg-emerald-50 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-emerald-950">Delivery Android app</div>
          <div className="text-xs text-emerald-700">Delivery users can install the mobile PWA and see only their assigned orders.</div>
          {routeMessage ? <div className="mt-1 text-xs font-medium text-emerald-900">{routeMessage}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50"
            disabled={optimizeRoutes.isPending}
            onClick={() => optimizeRoutes.mutate()}
          >
            <Route className="size-4" aria-hidden="true" />
            Optimize routes
          </button>
          <Link href="/delivery-app" className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white">
            <Smartphone className="size-4" aria-hidden="true" />
            Open app
          </Link>
        </div>
      </div>
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
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(delivery.proofs ?? []).slice(0, 3).map((proof) => (
                          <a
                            key={proof.id}
                            href={`/api/delivery/${delivery.id}/proofs/${proof.id}/view`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700"
                          >
                            <Camera className="size-3" aria-hidden="true" />
                            {proof.proofType.replaceAll("_", " ")}
                          </a>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {delivery.customer?.phone ? (
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 text-xs font-medium text-green-800"
                            onClick={() => shareDeliveryUpdate(delivery)}
                          >
                            <MessageCircle className="size-3.5" aria-hidden="true" />
                            Send update
                          </button>
                        ) : null}
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
                        <select name="userId" defaultValue={delivery.assignedTo ?? ""} className="h-8 min-w-0 flex-1 rounded-md border border-border px-2 text-xs">
                          <option value="">Assign person</option>
                          {deliveryUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                        </select>
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
