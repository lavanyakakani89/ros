"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Clock3, IndianRupee, MapPin, Navigation, Phone, RefreshCcw, UploadCloud, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { createAuthenticatedApiClient, logout } from "@/lib/api-client";
import {
  cacheMobileDeliveries,
  flushDeliveryQueues,
  getDeliveryQueueCounts,
  queueDeliveryStatusUpdate,
  queueLocationPing,
  readCachedMobileDeliveries,
  type MobileDeliveryStatus,
} from "@/lib/delivery-mobile-store";
import { cn } from "@/lib/utils";
import { getStoredAuthSession, getStoredTenant, hasStoredAuthSession } from "@/lib/vertical-config";

type DeliveryStatus = MobileDeliveryStatus;
type ProofType = "DELIVERY_PHOTO" | "PAYMENT_SCREENSHOT" | "CUSTOMER_SIGNATURE" | "OTHER";

interface DeliveryProof {
  id: string;
  proofType: ProofType;
  fileName: string;
  notes?: string | null;
  createdAt: string;
}

interface DeliveryItem {
  id: string;
  status: DeliveryStatus;
  deliveryAddress: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  priority?: number;
  weightKg?: string | number | null;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  notes?: string | null;
  assignedTo?: string | null;
  invoice?: {
    id?: string;
    invoiceNumber: string;
    grandTotal: string | number;
    amountDue?: string | number;
    paymentMode?: string;
  };
  customer?: {
    name: string;
    phone: string;
  };
  proofs?: DeliveryProof[];
  scheduledAt?: string | null;
  routeStop?: {
    sequence: number;
    eta?: string | null;
    distanceMeters?: number | null;
    durationSeconds?: number | null;
  } | null;
}

interface AppNotification {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

interface MobileRoute {
  id: string;
  totalDistanceMeters?: number | null;
  totalDurationSeconds?: number | null;
  stops?: unknown[];
}

interface MobileSyncResponse {
  serverTime: string;
  deliveries: DeliveryItem[];
  notifications: AppNotification[];
  route: MobileRoute | null;
}

export function DeliveryAgentApp() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"green" | "red">("green");
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [offlineMode, setOfflineMode] = useState(false);
  const [queueCounts, setQueueCounts] = useState({ statusUpdates: 0, locationPings: 0 });
  const notifiedIds = useRef(new Set<string>());
  const hasSession = typeof window !== "undefined" && hasStoredAuthSession();
  const tenant = typeof window !== "undefined" ? getStoredTenant() : null;
  const session = typeof window !== "undefined" ? getStoredAuthSession() : null;

  const syncQuery = useQuery({
    queryKey: ["delivery-agent", "mobile-sync"],
    queryFn: async () => {
      const apiClient = createAuthenticatedApiClient();
      try {
        await flushDeliveryQueues(apiClient);
        const response = await apiClient.get<MobileSyncResponse>("/delivery/mobile/sync");
        await cacheMobileDeliveries(response.deliveries);
        setOfflineMode(false);
        setQueueCounts(await getDeliveryQueueCounts());
        return response;
      } catch (error) {
        const cachedDeliveries = await readCachedMobileDeliveries<DeliveryItem>();
        setOfflineMode(true);
        setQueueCounts(await getDeliveryQueueCounts());
        if (cachedDeliveries.length > 0) {
          return {
            serverTime: new Date().toISOString(),
            deliveries: cachedDeliveries,
            notifications: [],
            route: null,
          };
        }

        throw error;
      }
    },
    enabled: hasSession,
    refetchInterval: 10_000,
  });
  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DeliveryStatus }) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueDeliveryStatusUpdate({ deliveryId: id, status });
        return { queued: true };
      }

      try {
        return await createAuthenticatedApiClient().put(`/delivery/${id}/status`, { status });
      } catch (error) {
        await queueDeliveryStatusUpdate({ deliveryId: id, status });
        return { queued: true, error };
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "mobile-sync"] });
      setQueueCounts(await getDeliveryQueueCounts());
      notify(typeof navigator !== "undefined" && !navigator.onLine ? "Status queued offline." : "Status updated.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Status update failed.", "red"),
  });
  const saveDeliveryPin = useMutation({
    mutationFn: async (deliveryId: string) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("Go online once to save this delivery pin.");
      }

      const location = await currentLocation();
      return createAuthenticatedApiClient().put(`/delivery/${deliveryId}/location`, {
        latitude: location.latitude,
        longitude: location.longitude,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "mobile-sync"] });
      notify("Delivery pin saved from current GPS location.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Could not save delivery pin.", "red"),
  });
  const uploadProof = useMutation({
    mutationFn: async ({ delivery, file, proofType }: { delivery: DeliveryItem; file: File; proofType: ProofType }) => {
      const location = await currentLocation().catch(() => null);
      const form = new FormData();
      form.append("file", file);
      form.append("proofType", proofType);
      const notes = proofNotes[proofNoteKey(delivery.id, proofType)]?.trim();
      if (notes) form.append("notes", notes);
      if (location) {
        form.append("latitude", String(location.latitude));
        form.append("longitude", String(location.longitude));
      }

      return createAuthenticatedApiClient().uploadForm(`/delivery/${delivery.id}/proofs`, form);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "mobile-sync"] });
      notify("Proof uploaded.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Proof upload failed.", "red"),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/delivery/notifications/${id}/read`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["delivery-agent", "mobile-sync"] }),
  });

  const deliveries = syncQuery.data?.deliveries ?? [];
  const notifications = syncQuery.data?.notifications ?? [];
  const route = syncQuery.data?.route ?? null;
  const unread = notifications.filter((notification) => !notification.isRead);
  const activeDeliveries = deliveries
    .filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status))
    .sort((left, right) => (left.routeStop?.sequence ?? 9999) - (right.routeStop?.sequence ?? 9999));
  const completedDeliveries = deliveries.filter((delivery) => ["DELIVERED", "FAILED", "CANCELLED"].includes(delivery.status));
  const totalCash = useMemo(
    () => activeDeliveries.reduce((sum, delivery) => sum + Number(delivery.invoice?.amountDue ?? delivery.invoice?.grandTotal ?? 0), 0),
    [activeDeliveries],
  );

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (notificationPermission !== "granted") return;

    for (const notification of unread) {
      if (notifiedIds.current.has(notification.id)) continue;
      notifiedIds.current.add(notification.id);
      new Notification(notification.title, { body: notification.body, tag: notification.id });
    }
  }, [notificationPermission, unread]);

  useEffect(() => {
    if (!hasSession || typeof window === "undefined") {
      return;
    }

    async function flushOnReconnect() {
      try {
        await flushDeliveryQueues(createAuthenticatedApiClient());
        setQueueCounts(await getDeliveryQueueCounts());
        await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "mobile-sync"] });
      } catch {
        setQueueCounts(await getDeliveryQueueCounts());
      }
    }

    window.addEventListener("online", flushOnReconnect);
    return () => window.removeEventListener("online", flushOnReconnect);
  }, [hasSession, queryClient]);

  useEffect(() => {
    if (!hasSession || activeDeliveries.length === 0) {
      return;
    }

    const activeDelivery = activeDeliveries.find((delivery) => delivery.status === "OUT_FOR_DELIVERY") ?? activeDeliveries[0];
    if (!activeDelivery) {
      return;
    }
    const activeDeliveryId = activeDelivery.id;
    let cancelled = false;

    async function capturePing() {
      const location = await currentLocation().catch(() => null);
      if (!location || cancelled) {
        return;
      }

      await queueLocationPing({
        deliveryId: activeDeliveryId,
        latitude: location.latitude,
        longitude: location.longitude,
        ...(location.accuracy !== undefined ? { accuracyMeters: location.accuracy } : {}),
        capturedAt: new Date(),
      });

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushDeliveryQueues(createAuthenticatedApiClient()).catch(() => undefined);
      }

      setQueueCounts(await getDeliveryQueueCounts());
    }

    void capturePing();
    const interval = window.setInterval(() => void capturePing(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasSession, activeDeliveries]);

  function notify(nextMessage: string, tone: "green" | "red" = "green") {
    setMessage(nextMessage);
    setMessageTone(tone);
  }

  async function requestNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
        <div className="mx-auto max-w-sm">
          <div className="text-sm font-semibold text-emerald-300">RetailOS Delivery</div>
          <h1 className="mt-3 text-3xl font-bold">Sign in to view assigned orders.</h1>
          <p className="mt-3 text-sm text-slate-300">Use the same shop slug, email, and password created for the delivery user in RetailOS settings.</p>
          <Link href="/login" className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-emerald-500 text-sm font-semibold text-slate-950">Sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-10 border-b border-emerald-800 bg-emerald-700 px-4 py-3 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{tenant?.name ?? "RetailOS"}</div>
            <div className="truncate text-xs text-emerald-100">{session?.user?.name ?? "Delivery app"}</div>
          </div>
          <button className="rounded-md border border-emerald-500 px-3 py-1.5 text-xs font-semibold" onClick={() => void handleLogout()}>Logout</button>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2 px-3 py-3">
        <Metric label="Active" value={String(activeDeliveries.length)} icon={<Navigation className="size-4" aria-hidden="true" />} />
        <Metric label="Unread" value={String(unread.length)} icon={<Bell className="size-4" aria-hidden="true" />} />
        <Metric label="Collect" value={`₹${totalCash.toFixed(0)}`} icon={<IndianRupee className="size-4" aria-hidden="true" />} />
      </section>

      <section className="space-y-2 px-3">
        <div className="flex items-center justify-between gap-2">
          <button
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700"
            onClick={() => {
              void syncQuery.refetch();
            }}
          >
            <RefreshCcw className="size-4" aria-hidden="true" />
            Sync
          </button>
          <button className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700" onClick={() => void requestNotifications()}>
            Alerts: {notificationPermission}
          </button>
        </div>
        {message ? (
          <div className={cn("rounded-md border px-3 py-2 text-sm", messageTone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700")}>{message}</div>
        ) : null}
        {offlineMode ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Offline mode: showing cached route. Queued status updates sync automatically on reconnect.
          </div>
        ) : null}
        {syncQuery.error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {syncQuery.error.message}
          </div>
        ) : null}
      </section>

      {unread.length > 0 ? (
        <section className="mt-3 space-y-2 px-3">
          {unread.slice(0, 3).map((notification) => (
            <button
              key={notification.id}
              className="w-full rounded-md border border-emerald-200 bg-white p-3 text-left shadow-sm"
              onClick={() => markRead.mutate(notification.id)}
            >
              <div className="flex items-start gap-2">
                <Bell className="mt-0.5 size-4 text-emerald-700" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{notification.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{notification.body}</span>
                </span>
              </div>
            </button>
          ))}
        </section>
      ) : null}

      <section className="mt-4 space-y-3 px-3 pb-6">
        {route ? (
          <div className="rounded-md border border-emerald-200 bg-white p-3 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Optimized route</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded bg-emerald-50 p-2">
                <div className="font-bold">{String(activeDeliveries.length)}</div>
                <div className="text-[11px] text-slate-500">stops</div>
              </div>
              <div className="rounded bg-emerald-50 p-2">
                <div className="font-bold">{formatKm(route.totalDistanceMeters)}</div>
                <div className="text-[11px] text-slate-500">km</div>
              </div>
              <div className="rounded bg-emerald-50 p-2">
                <div className="font-bold">{formatMinutes(route.totalDurationSeconds)}</div>
                <div className="text-[11px] text-slate-500">ETA</div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          Network: {typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline"} | queued status {queueCounts.statusUpdates} | queued GPS {queueCounts.locationPings}
        </div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned orders</div>
        {activeDeliveries.map((delivery) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            proofNotes={proofNotes}
            setProofNotes={setProofNotes}
            updating={updateStatus.isPending}
            uploading={uploadProof.isPending}
            onStatus={(status) => updateStatus.mutate({ id: delivery.id, status })}
            onProof={(file, proofType) => uploadProof.mutate({ delivery, file, proofType })}
            onSaveLocation={() => saveDeliveryPin.mutate(delivery.id)}
            savingLocation={saveDeliveryPin.isPending}
          />
        ))}
        {activeDeliveries.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center">
            <Clock3 className="mx-auto size-7 text-slate-400" aria-hidden="true" />
            <div className="mt-2 text-sm font-semibold">No assigned deliveries</div>
            <div className="mt-1 text-xs text-slate-500">New assignments will appear here automatically.</div>
          </div>
        ) : null}

        {completedDeliveries.length > 0 ? (
          <>
            <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Completed today</div>
            {completedDeliveries.slice(0, 6).map((delivery) => (
              <div key={delivery.id} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
                  <StatusBadge status={delivery.status} />
                </div>
                <div className="mt-1 text-sm font-medium">{delivery.customer?.name ?? "Customer"}</div>
              </div>
            ))}
          </>
        ) : null}
      </section>
    </main>
  );
}

function DeliveryCard({
  delivery,
  proofNotes,
  setProofNotes,
  updating,
  uploading,
  savingLocation,
  onStatus,
  onProof,
  onSaveLocation,
}: Readonly<{
  delivery: DeliveryItem;
  proofNotes: Record<string, string>;
  setProofNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  updating: boolean;
  uploading: boolean;
  savingLocation: boolean;
  onStatus: (status: DeliveryStatus) => void;
  onProof: (file: File, proofType: ProofType) => void;
  onSaveLocation: () => void;
}>) {
  const deliveryPhotoCount = delivery.proofs?.filter((proof) => proof.proofType === "DELIVERY_PHOTO").length ?? 0;
  const paymentProofCount = delivery.proofs?.filter((proof) => proof.proofType === "PAYMENT_SCREENSHOT").length ?? 0;
  const hasCoordinates = delivery.latitude !== undefined && delivery.latitude !== null && delivery.longitude !== undefined && delivery.longitude !== null;
  const mapUrl = hasCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${String(delivery.latitude)},${String(delivery.longitude)}`)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.deliveryAddress)}`;
  const customerPhone = delivery.customer?.phone ?? "";

  return (
    <article className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-xs text-slate-500">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
            <div className="mt-1 text-lg font-bold">₹{Number(delivery.invoice?.grandTotal ?? 0).toFixed(2)}</div>
            {delivery.routeStop ? <div className="mt-1 text-xs font-semibold text-emerald-700">Stop #{delivery.routeStop.sequence}</div> : null}
          </div>
          <StatusBadge status={delivery.status} />
        </div>
        <div className="mt-3 grid gap-1 text-sm">
          <div className="font-semibold">{delivery.customer?.name ?? "Customer"}</div>
          {customerPhone ? <a className="inline-flex items-center gap-2 text-emerald-700" href={`tel:${customerPhone}`}><Phone className="size-4" aria-hidden="true" />{customerPhone}</a> : null}
          <a className="inline-flex items-start gap-2 text-slate-600" href={mapUrl} target="_blank" rel="noreferrer">
            <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>{delivery.deliveryAddress}</span>
          </a>
          <a className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-800" href={mapUrl} target="_blank" rel="noreferrer">
            <Navigation className="size-4" aria-hidden="true" />
            Navigate
          </a>
          {!hasCoordinates ? (
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-200 bg-amber-50 text-sm font-semibold text-amber-800 disabled:opacity-50"
              disabled={savingLocation}
              onClick={onSaveLocation}
            >
              <MapPin className="size-4" aria-hidden="true" />
              Save current pin
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <ProofInput
            label={`Delivery photo (${String(deliveryPhotoCount)})`}
            proofType="DELIVERY_PHOTO"
            disabled={uploading}
            onProof={onProof}
          />
          <ProofInput
            label={`Payment screenshot (${String(paymentProofCount)})`}
            proofType="PAYMENT_SCREENSHOT"
            disabled={uploading}
            onProof={onProof}
          />
        </div>

        <input
          value={proofNotes[proofNoteKey(delivery.id, "DELIVERY_PHOTO")] ?? ""}
          onChange={(event) => setProofNotes((current) => ({ ...current, [proofNoteKey(delivery.id, "DELIVERY_PHOTO")]: event.target.value }))}
          placeholder="Proof note / cash collected note"
          className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-600"
        />

        <div className="grid grid-cols-2 gap-2">
          {delivery.status === "ASSIGNED" || delivery.status === "PENDING" ? (
            <button className="h-10 rounded-md bg-sky-600 text-sm font-semibold text-white disabled:opacity-50" disabled={updating} onClick={() => onStatus("OUT_FOR_DELIVERY")}>
              Start delivery
            </button>
          ) : null}
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
            disabled={updating || deliveryPhotoCount === 0}
            title={deliveryPhotoCount === 0 ? "Upload delivery photo before marking delivered" : "Mark delivered"}
            onClick={() => onStatus("DELIVERED")}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Delivered
          </button>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={updating} onClick={() => onStatus("FAILED")}>
            <XCircle className="size-4" aria-hidden="true" />
            Failed
          </button>
        </div>
      </div>
    </article>
  );
}

function ProofInput({ label, proofType, disabled, onProof }: Readonly<{ label: string; proofType: ProofType; disabled: boolean; onProof: (file: File, proofType: ProofType) => void }>) {
  return (
    <label className={cn("flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 text-center text-xs font-semibold text-slate-700", disabled && "opacity-50")}>
      <UploadCloud className="size-5 text-emerald-700" aria-hidden="true" />
      {label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onProof(file, proofType);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function Metric({ label, value, icon }: Readonly<{ label: string; value: string; icon: React.ReactNode }>) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: DeliveryStatus }>) {
  return <span className={cn("rounded px-2 py-1 text-[11px] font-bold", statusClass(status))}>{status.replaceAll("_", " ")}</span>;
}

function statusClass(status: DeliveryStatus): string {
  if (status === "DELIVERED") return "bg-emerald-50 text-emerald-700";
  if (status === "OUT_FOR_DELIVERY") return "bg-sky-50 text-sky-700";
  if (status === "FAILED" || status === "CANCELLED") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function proofNoteKey(deliveryId: string, proofType: ProofType): string {
  return `${deliveryId}:${proofType}`;
}

function formatKm(distanceMeters?: number | null): string {
  if (!distanceMeters) return "-";
  return (distanceMeters / 1000).toFixed(1);
}

function formatMinutes(durationSeconds?: number | null): string {
  if (!durationSeconds) return "-";
  return `${String(Math.round(durationSeconds / 60))}m`;
}

function currentLocation(): Promise<{ latitude: number; longitude: number; accuracy?: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not available"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      reject,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    );
  });
}
