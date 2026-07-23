"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ClipboardList, MessageCircle, Route, Smartphone, Truck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { appendDateRange, todayDate } from "@/lib/date-range";
import { formString } from "@/lib/form-values";
import { getStoredTenant } from "@/lib/vertical-config";
import { fetchWhatsappMessageTemplates, formatDeliveryWhatsappMessage, getWhatsappTemplateBody, openWhatsappMessage } from "@/lib/whatsapp";
import { DeliveryRoutePlanner } from "./delivery-route-planner";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";

interface DeliveryItem {
  id: string;
  status: DeliveryStatus;
  deliveryAddress: string;
  deliveryLatitude?: string | number | null;
  deliveryLongitude?: string | number | null;
  assignedTo?: string | null;
  createdAt?: string;
  deliveredAt?: string | null;
  invoice?: {
    invoiceNumber: string;
    grandTotal: string;
  };
  customer?: {
    name: string;
    phone: string;
    locations?: Array<{
      latitude?: string | number | null;
      longitude?: string | number | null;
    }>;
  };
  customerLocation?: {
    latitude?: string | number | null;
    longitude?: string | number | null;
    manuallyVerifiedAt?: string | null;
    geocodingConfidence?: string | number | null;
  } | null;
  proofs?: Array<{
    id: string;
    proofType: "DELIVERY_PHOTO" | "PAYMENT_SCREENSHOT" | "CUSTOMER_SIGNATURE" | "OTHER";
    fileName: string;
    notes?: string | null;
    createdAt: string;
  }>;
}

interface SettingsResponse {
  store: {
    depotName?: string | null;
    depotAddress?: string | null;
    depotLatitude?: string | number | null;
    depotLongitude?: string | number | null;
  } | null;
  users: Array<{
    id: string;
    name: string;
    role: string;
    isActive: boolean;
    lastLatitude?: string | number | null;
    lastLongitude?: string | number | null;
    lastLocationAccuracy?: string | number | null;
    lastLocationAt?: string | null;
  }>;
}

const statuses: DeliveryStatus[] = ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"];

const fallbackDeliveries: DeliveryItem[] = [];

export function DeliveryBoard() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => todayDate());
  const [to, setTo] = useState(() => todayDate());
  const [view, setView] = useState<"board" | "route-planning">("board");
  const activeDeliveriesQuery = useQuery({
    queryKey: ["deliveries", "board", "active"],
    queryFn: () => createAuthenticatedApiClient().get<DeliveryItem[]>("/delivery?scope=active"),
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const deliveredDeliveriesQuery = useQuery({
    queryKey: ["deliveries", "board", "delivered", from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      appendDateRange(params, from, to);
      params.set("status", "DELIVERED");
      const query = params.toString();
      return createAuthenticatedApiClient().get<DeliveryItem[]>(`/delivery${query ? `?${query}` : ""}`);
    },
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const usersQuery = useQuery({
    queryKey: ["settings-current", "delivery-users"],
    queryFn: () => createAuthenticatedApiClient().get<SettingsResponse>("/settings/current"),
    staleTime: 60_000,
  });
  const whatsappTemplatesQuery = useQuery({
    queryKey: ["whatsapp-message-templates"],
    queryFn: fetchWhatsappMessageTemplates,
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

  const deliveries = [...(activeDeliveriesQuery.data ?? fallbackDeliveries), ...(deliveredDeliveriesQuery.data ?? fallbackDeliveries)];
  const deliveryUsers = (usersQuery.data?.users ?? []).filter((user) => user.role === "DELIVERY" && user.isActive);
  const depot = usersQuery.data?.store ? {
    name: usersQuery.data.store.depotName ?? null,
    address: usersQuery.data.store.depotAddress ?? null,
    latitude: usersQuery.data.store.depotLatitude ?? null,
    longitude: usersQuery.data.store.depotLongitude ?? null,
  } : null;
  const isLoadingBoard = activeDeliveriesQuery.isLoading || deliveredDeliveriesQuery.isLoading;
  const boardError = activeDeliveriesQuery.error ?? deliveredDeliveriesQuery.error;

  function shareDeliveryUpdate(delivery: DeliveryItem) {
    const templateKey = delivery.status === "DELIVERED" ? "deliveryDelivered" : "deliveryOutForDelivery";
    openWhatsappMessage(
      delivery.customer?.phone,
      formatDeliveryWhatsappMessage({
        tenantName: getStoredTenant()?.name ?? "your shop",
        customerName: delivery.customer?.name,
        invoiceNumber: delivery.invoice?.invoiceNumber,
        grandTotal: delivery.invoice?.grandTotal,
        status: delivery.status,
        address: delivery.deliveryAddress,
        templateBody: getWhatsappTemplateBody(whatsappTemplatesQuery.data, templateKey),
      }),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-100 bg-emerald-50 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-emerald-950">Delivery Android app</div>
          <div className="text-xs text-emerald-700">Delivery users can install the mobile PWA and see only their assigned orders.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-sm text-slate-700" aria-label="Delivery from date" />
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-md border border-emerald-200 bg-white px-2 text-sm text-slate-700" aria-label="Delivery to date" />
          <Link href="/delivery-app" className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white">
            <Smartphone className="size-4" aria-hidden="true" />
            Open app
          </Link>
        </div>
      </div>
      {boardError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(boardError instanceof Error ? boardError.message : "Unable to load deliveries right now.")} Try again in a moment.
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-white p-2">
        <button className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${view === "board" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`} onClick={() => setView("board")}>
          <ClipboardList className="size-4" aria-hidden="true" />
          Board
        </button>
        <button className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${view === "route-planning" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`} onClick={() => setView("route-planning")}>
          <Route className="size-4" aria-hidden="true" />
          Route planning
        </button>
      </div>
      {view === "route-planning" ? (
        <DeliveryRoutePlanner deliveries={activeDeliveriesQuery.data ?? fallbackDeliveries} users={deliveryUsers} depot={depot} />
      ) : (
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
              {items.map((delivery) => {
                const coordinates = deliveryCoordinates(delivery);
                const assignedUser = delivery.assignedTo ? deliveryUsers.find((user) => user.id === delivery.assignedTo) : null;
                const driverLocation = assignedUser ? deliveryUserLocation(assignedUser) : null;
                const deliveryProof = firstProofByType(delivery, "DELIVERY_PHOTO");
                const paymentProof = firstProofByType(delivery, "PAYMENT_SCREENSHOT");
                return (
                <article key={delivery.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <Truck className="mt-0.5 size-4 text-emerald-700" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
                      <div className="mt-1 text-xs text-slate-500">{delivery.customer?.name ?? "Customer"}</div>
                      <div className="mt-1 text-xs text-slate-500">{delivery.deliveryAddress}</div>
                      {coordinates ? (
                        <a
                          href={googleMapsUrl(coordinates)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] font-medium text-emerald-700"
                        >
                          Pin {coordinates.latitude.toFixed(7)}, {coordinates.longitude.toFixed(7)}
                        </a>
                      ) : null}
                      <div className="mt-2 text-sm font-semibold text-slate-900">₹{delivery.invoice?.grandTotal ?? "0.00"}</div>
                      {assignedUser ? (
                        driverLocation ? (
                          <a
                            href={googleMapsUrl(driverLocation)}
                            target="_blank"
                            rel="noreferrer"
                            className={`mt-2 inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-semibold ${driverLocation.isStale ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
                            title={driverLocation.accuracy ? `Accuracy ${Math.round(driverLocation.accuracy).toString()} m` : "Latest delivery person location"}
                          >
                            {assignedUser.name} - {formatLocationAge(driverLocation.capturedAt)}
                          </a>
                        ) : (
                          <div className="mt-2 text-[11px] font-semibold text-slate-400">{assignedUser.name} - No location</div>
                        )
                      ) : null}
                      {deliveryProof || paymentProof ? (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {deliveryProof ? <ProofThumb deliveryId={delivery.id} proof={deliveryProof} label="Delivery proof" /> : null}
                          {paymentProof ? <ProofThumb deliveryId={delivery.id} proof={paymentProof} label="Payment screenshot" /> : null}
                        </div>
                      ) : null}
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
              );
              })}
              {items.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                  {isLoadingBoard ? "Loading deliveries..." : "No deliveries"}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
      </div>
      )}
    </div>
  );
}

function deliveryCoordinates(delivery: DeliveryItem): { latitude: number; longitude: number } | null {
  const latitude = Number(delivery.customerLocation?.latitude ?? delivery.customer?.locations?.[0]?.latitude ?? delivery.deliveryLatitude);
  const longitude = Number(delivery.customerLocation?.longitude ?? delivery.customer?.locations?.[0]?.longitude ?? delivery.deliveryLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function googleMapsUrl(coordinates: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps?q=${coordinates.latitude.toString()},${coordinates.longitude.toString()}`;
}

function deliveryUserLocation(user: SettingsResponse["users"][number]): { latitude: number; longitude: number; accuracy: number | null; capturedAt: Date; isStale: boolean } | null {
  const latitude = Number(user.lastLatitude);
  const longitude = Number(user.lastLongitude);
  const capturedAt = user.lastLocationAt ? new Date(user.lastLocationAt) : null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !capturedAt || Number.isNaN(capturedAt.getTime())) {
    return null;
  }

  const ageMs = Date.now() - capturedAt.getTime();
  return {
    latitude,
    longitude,
    accuracy: user.lastLocationAccuracy === null || user.lastLocationAccuracy === undefined ? null : Number(user.lastLocationAccuracy),
    capturedAt,
    isStale: ageMs > 15 * 60 * 1000,
  };
}

function formatLocationAge(capturedAt: Date): string {
  const diffMs = Math.max(Date.now() - capturedAt.getTime(), 0);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "<1m ago";
  if (minutes < 60) return `${minutes.toString()}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours.toString()}h ago`;

  const days = Math.floor(hours / 24);
  return `${days.toString()}d ago`;
}

function ProofThumb({ deliveryId, proof, label }: Readonly<{ deliveryId: string; proof: NonNullable<DeliveryItem["proofs"]>[number]; label: string }>) {
  return (
    <a
      href={proofViewUrl(deliveryId, proof.id)}
      target="_blank"
      rel="noreferrer"
      className="group overflow-hidden rounded-md border border-sky-100 bg-sky-50 text-sky-800"
    >
      <img
        src={proofViewUrl(deliveryId, proof.id)}
        alt={label}
        className="h-16 w-full object-cover"
        loading="lazy"
      />
      <span className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold">
        <Camera className="size-3" aria-hidden="true" />
        {label}
      </span>
      {proof.notes ? <span className="block truncate px-2 pb-1 text-[10px] text-sky-700">{proof.notes}</span> : null}
    </a>
  );
}

function firstProofByType(delivery: DeliveryItem, proofType: NonNullable<DeliveryItem["proofs"]>[number]["proofType"]) {
  return delivery.proofs?.find((proof) => proof.proofType === proofType) ?? null;
}

function proofViewUrl(deliveryId: string, proofId: string): string {
  return `/api/delivery/${deliveryId}/proofs/${proofId}/view`;
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
