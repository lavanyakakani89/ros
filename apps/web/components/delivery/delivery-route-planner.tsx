"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LocateFixed, Lock, MapPin, Navigation, Play, Route, Send, Unlock } from "lucide-react";
import { useMemo, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { getStoredTenant } from "@/lib/vertical-config";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";
type RoutePlanStatus = "DRAFT" | "GEOCODING" | "LOCATION_REVIEW_REQUIRED" | "QUEUED" | "OPTIMIZING" | "OPTIMIZATION_FAILED" | "READY_FOR_REVIEW" | "APPLIED" | "PUBLISHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface RoutePlannerDelivery {
  id: string;
  status: DeliveryStatus;
  deliveryAddress: string;
  deliveryLatitude?: string | number | null;
  deliveryLongitude?: string | number | null;
  customerLocation?: {
    latitude?: string | number | null;
    longitude?: string | number | null;
    manuallyVerifiedAt?: string | null;
    geocodingConfidence?: string | number | null;
  } | null;
  invoice?: {
    invoiceNumber: string;
    grandTotal: string;
  };
  customer?: {
    name: string;
    phone: string;
  };
}

export interface RoutePlannerUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

interface RoutePlan {
  id: string;
  name: string;
  status: RoutePlanStatus;
  provider?: string | null;
  providerError?: string | null;
  totalDistanceMeters?: number | null;
  totalDurationSeconds?: number | null;
  routes: Array<{
    id: string;
    assignedTo?: string | null;
    driver?: {
      id: string;
      name: string;
      phone?: string | null;
    } | null;
    distanceMeters?: number | null;
    durationSeconds?: number | null;
    stops: Array<{
      id: string;
      sequence: number;
      status: string;
      isLocked: boolean;
      delivery?: RoutePlannerDelivery & {
        invoice?: {
          invoiceNumber: string;
          grandTotal: string | number;
        };
      };
    }>;
  }>;
}

export function DeliveryRoutePlanner({ deliveries, users }: Readonly<{ deliveries: RoutePlannerDelivery[]; users: RoutePlannerUser[] }>) {
  const queryClient = useQueryClient();
  const tenant = typeof window !== "undefined" ? getStoredTenant() : null;
  const activeDeliveries = deliveries.filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status));
  const deliveryUsers = users.filter((user) => user.role === "DELIVERY" && user.isActive);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);
  const [depotAddress, setDepotAddress] = useState("");
  const [depotLatitude, setDepotLatitude] = useState("");
  const [depotLongitude, setDepotLongitude] = useState("");
  const [pinInputs, setPinInputs] = useState<Record<string, { latitude: string; longitude: string }>>({});
  const selectedDeliveries = activeDeliveries.filter((delivery) => selectedDeliveryIds.includes(delivery.id));
  const missingPins = selectedDeliveries.filter((delivery) => !hasLocation(delivery));

  const plansQuery = useQuery({
    queryKey: ["delivery-route-plans"],
    queryFn: () => createAuthenticatedApiClient().get<RoutePlan[]>("/delivery-route-plans"),
    refetchInterval: 5_000,
  });
  const createPlan = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<RoutePlan>("/delivery-route-plans", {
      deliveryIds: selectedDeliveryIds,
      driverIds: selectedDriverIds,
      depotName: tenant?.name ?? "Store",
      depotAddress,
      depotLatitude: Number(depotLatitude),
      depotLongitude: Number(depotLongitude),
      optimize: true,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["delivery-route-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
      ]);
    },
  });
  const geocodeBatch = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post("/deliveries/geocode-batch", { deliveryIds: selectedDeliveryIds }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
  });
  const savePin = useMutation({
    mutationFn: ({ deliveryId, latitude, longitude }: { deliveryId: string; latitude: string; longitude: string }) => createAuthenticatedApiClient().patch(`/deliveries/${deliveryId}/location`, {
      latitude: Number(latitude),
      longitude: Number(longitude),
      manuallyVerified: true,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
  });
  const optimizePlan = useMutation({
    mutationFn: (planId: string) => createAuthenticatedApiClient().post(`/delivery-route-plans/${planId}/optimize`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["delivery-route-plans"] }),
  });
  const applyPlan = useMutation({
    mutationFn: (planId: string) => createAuthenticatedApiClient().post(`/delivery-route-plans/${planId}/apply`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["delivery-route-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
      ]);
    },
  });
  const publishPlan = useMutation({
    mutationFn: (planId: string) => createAuthenticatedApiClient().post(`/delivery-route-plans/${planId}/publish`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["delivery-route-plans"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveries"] }),
      ]);
    },
  });
  const lockStop = useMutation({
    mutationFn: ({ planId, stopId, locked }: { planId: string; stopId: string; locked: boolean }) => createAuthenticatedApiClient().post(`/delivery-route-plans/${planId}/stops/${stopId}/${locked ? "lock" : "unlock"}`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["delivery-route-plans"] }),
  });

  const latestPlans = plansQuery.data ?? [];
  const canCreate = selectedDeliveryIds.length > 0 && selectedDriverIds.length > 0 && depotLatitude.trim() && depotLongitude.trim();
  const selectedSummary = useMemo(() => ({
    deliveries: selectedDeliveryIds.length,
    drivers: selectedDriverIds.length,
    missingPins: missingPins.length,
  }), [missingPins.length, selectedDeliveryIds.length, selectedDriverIds.length]);

  function toggleDelivery(id: string) {
    setSelectedDeliveryIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleDriver(id: string) {
    setSelectedDriverIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return (
    <section className="rounded-md border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Route className="size-4 text-emerald-700" aria-hidden="true" />
            Route optimization
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {selectedSummary.deliveries} stops | {selectedSummary.drivers} drivers | {selectedSummary.missingPins} pins need review
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 disabled:opacity-50"
            disabled={selectedDeliveryIds.length === 0 || geocodeBatch.isPending}
            onClick={() => geocodeBatch.mutate()}
          >
            <LocateFixed className="size-4" aria-hidden="true" />
            Geocode selected
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
            disabled={!canCreate || createPlan.isPending}
            onClick={() => createPlan.mutate()}
          >
            <Navigation className="size-4" aria-hidden="true" />
            Create optimized plan
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={depotAddress} onChange={(event) => setDepotAddress(event.target.value)} placeholder="Depot address" className="h-10 rounded-md border border-border px-3 text-sm sm:col-span-3" />
            <input value={depotLatitude} onChange={(event) => setDepotLatitude(event.target.value)} placeholder="Depot lat" inputMode="decimal" className="h-10 rounded-md border border-border px-3 text-sm" />
            <input value={depotLongitude} onChange={(event) => setDepotLongitude(event.target.value)} placeholder="Depot lng" inputMode="decimal" className="h-10 rounded-md border border-border px-3 text-sm" />
            <button
              className="h-10 rounded-md border border-border px-3 text-sm font-semibold text-slate-700"
              onClick={() => {
                if (!("geolocation" in navigator)) return;
                navigator.geolocation.getCurrentPosition((position) => {
                  setDepotLatitude(String(position.coords.latitude));
                  setDepotLongitude(String(position.coords.longitude));
                });
              }}
            >
              Use current pin
            </button>
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery drivers</div>
            <div className="flex flex-wrap gap-2">
              {deliveryUsers.map((user) => (
                <button
                  key={user.id}
                  className={`h-9 rounded-md border px-3 text-xs font-semibold ${selectedDriverIds.includes(user.id) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-border text-slate-700"}`}
                  onClick={() => toggleDriver(user.id)}
                >
                  {user.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selectable stops</div>
              <button className="text-xs font-semibold text-emerald-700" onClick={() => setSelectedDeliveryIds(activeDeliveries.map((delivery) => delivery.id))}>Select all active</button>
            </div>
            <div className="max-h-80 space-y-2 overflow-auto pr-1">
              {activeDeliveries.map((delivery) => {
                const locationReady = hasLocation(delivery);
                const pin = pinInputs[delivery.id] ?? {
                  latitude: String(delivery.deliveryLatitude ?? delivery.customerLocation?.latitude ?? ""),
                  longitude: String(delivery.deliveryLongitude ?? delivery.customerLocation?.longitude ?? ""),
                };
                return (
                  <article key={delivery.id} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={selectedDeliveryIds.includes(delivery.id)} onChange={() => toggleDelivery(delivery.id)} className="mt-1 size-4" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
                          <span className={`rounded px-2 py-1 text-[11px] font-bold ${locationReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                            {locationReady ? "PIN READY" : "PIN NEEDED"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{delivery.customer?.name ?? "Customer"}</div>
                        <div className="mt-1 text-xs text-slate-500">{delivery.deliveryAddress}</div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <input
                            value={pin.latitude}
                            onChange={(event) => setPinInputs((current) => ({ ...current, [delivery.id]: { ...pin, latitude: event.target.value } }))}
                            placeholder="Lat"
                            inputMode="decimal"
                            className="h-8 rounded-md border border-border px-2 text-xs"
                          />
                          <input
                            value={pin.longitude}
                            onChange={(event) => setPinInputs((current) => ({ ...current, [delivery.id]: { ...pin, longitude: event.target.value } }))}
                            placeholder="Lng"
                            inputMode="decimal"
                            className="h-8 rounded-md border border-border px-2 text-xs"
                          />
                          <button
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                            disabled={!pin.latitude || !pin.longitude || savePin.isPending}
                            onClick={() => savePin.mutate({ deliveryId: delivery.id, latitude: pin.latitude, longitude: pin.longitude })}
                          >
                            <MapPin className="size-3.5" aria-hidden="true" />
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Route plans</div>
          {latestPlans.map((plan) => (
            <article key={plan.id} className="rounded-md border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{plan.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{plan.provider ?? "pending provider"} | {formatDistance(plan.totalDistanceMeters)} | {formatDuration(plan.totalDurationSeconds)}</div>
                  {plan.providerError ? <div className="mt-1 text-xs font-medium text-red-700">{plan.providerError}</div> : null}
                </div>
                <span className={`rounded px-2 py-1 text-[11px] font-bold ${planStatusClass(plan.status)}`}>{plan.status.replaceAll("_", " ")}</span>
              </div>
              <div className="space-y-3 p-3">
                <div className="flex flex-wrap gap-2">
                  <button className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-semibold text-slate-700" onClick={() => optimizePlan.mutate(plan.id)}>
                    <Play className="size-3.5" aria-hidden="true" />
                    Optimize
                  </button>
                  <button className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800 disabled:opacity-50" disabled={plan.status !== "READY_FOR_REVIEW" && plan.status !== "APPLIED"} onClick={() => applyPlan.mutate(plan.id)}>
                    <Check className="size-3.5" aria-hidden="true" />
                    Apply
                  </button>
                  <button className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-700 px-2 text-xs font-semibold text-white disabled:opacity-50" disabled={plan.status !== "READY_FOR_REVIEW" && plan.status !== "APPLIED" && plan.status !== "PUBLISHED"} onClick={() => publishPlan.mutate(plan.id)}>
                    <Send className="size-3.5" aria-hidden="true" />
                    Publish
                  </button>
                </div>
                {plan.routes.map((route) => (
                  <div key={route.id} className="rounded-md border border-slate-100">
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                      <div className="text-xs font-semibold text-slate-700">{route.driver?.name ?? "Driver"} route</div>
                      <div className="text-[11px] text-slate-500">{formatDistance(route.distanceMeters)} | {formatDuration(route.durationSeconds)}</div>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {route.stops.map((stop) => (
                        <div key={stop.id} className="flex items-start gap-2 px-3 py-2">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-bold text-slate-600">{stop.sequence}</div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold">{stop.delivery?.invoice?.invoiceNumber ?? stop.id}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{stop.delivery?.customer?.name ?? "Customer"}</div>
                          </div>
                          <button className="size-8 rounded-md border border-border text-slate-600" title={stop.isLocked ? "Unlock stop" : "Lock stop"} onClick={() => lockStop.mutate({ planId: plan.id, stopId: stop.id, locked: !stop.isLocked })}>
                            {stop.isLocked ? <Lock className="mx-auto size-3.5" aria-hidden="true" /> : <Unlock className="mx-auto size-3.5" aria-hidden="true" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {latestPlans.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              No route plans yet.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function hasLocation(delivery: RoutePlannerDelivery): boolean {
  return Boolean((delivery.deliveryLatitude ?? delivery.customerLocation?.latitude) && (delivery.deliveryLongitude ?? delivery.customerLocation?.longitude));
}

function formatDistance(value: number | null | undefined): string {
  if (!value) return "0 km";
  return `${(value / 1000).toFixed(1)} km`;
}

function formatDuration(value: number | null | undefined): string {
  if (!value) return "0 min";
  return `${Math.round(value / 60).toString()} min`;
}

function planStatusClass(status: RoutePlanStatus): string {
  if (status === "READY_FOR_REVIEW" || status === "APPLIED" || status === "PUBLISHED") return "bg-emerald-50 text-emerald-700";
  if (status === "OPTIMIZATION_FAILED" || status === "LOCATION_REVIEW_REQUIRED") return "bg-red-50 text-red-700";
  if (status === "QUEUED" || status === "OPTIMIZING" || status === "GEOCODING") return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-600";
}
