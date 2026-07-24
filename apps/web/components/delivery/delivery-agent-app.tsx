"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Clock3, IndianRupee, MapPin, Navigation, Phone, RefreshCcw, UploadCloud, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { createAuthenticatedApiClient, getCurrentVerticalConfig, logout } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getStoredAuthSession, getStoredTenant, hasStoredAuthSession, storeTenant } from "@/lib/vertical-config";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";
type ProofType = "DELIVERY_PHOTO" | "PAYMENT_SCREENSHOT" | "CUSTOMER_SIGNATURE" | "OTHER";
type WebkitAudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
const PROOF_IMAGE_MAX_DIMENSION = 960;
const PROOF_IMAGE_MAX_UPLOAD_BYTES = 300 * 1024;
const PROOF_IMAGE_QUALITY_STEPS = [0.62, 0.52, 0.42, 0.34] as const;
const DELIVERY_ALERT_SOUND_KEY = "bizbil_delivery_alert_sound";

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
  deliveryLatitude?: string | number | null;
  deliveryLongitude?: string | number | null;
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
    locations?: Array<{
      latitude?: string | number | null;
      longitude?: string | number | null;
    }>;
  };
  customerLocation?: {
    latitude?: string | number | null;
    longitude?: string | number | null;
  };
  proofs?: DeliveryProof[];
  scheduledAt?: string | null;
  deliveredAt?: string | null;
}

interface AppNotification {
  id: string;
  title: string;
  body: string;
  type?: string;
  isRead: boolean;
  createdAt: string;
}

interface DriverRoute {
  id: string;
  status: string;
  routePlan?: {
    id: string;
    name: string;
    status: string;
  };
  stops: Array<{
    id: string;
    sequence: number;
    status: string;
    delivery?: DeliveryItem;
  }>;
}

interface DepotResponse {
  depotName?: string | null;
  depotAddress?: string | null;
  depotLatitude?: string | number | null;
  depotLongitude?: string | number | null;
}

export function DeliveryAgentApp() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"green" | "red">("green");
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(false);
  const notifiedIds = useRef(new Set<string>());
  const notificationsInitialized = useRef(false);
  const alertAudioContext = useRef<AudioContext | null>(null);
  const hasSession = typeof window !== "undefined" && hasStoredAuthSession();
  const tenant = typeof window !== "undefined" ? getStoredTenant() : null;
  const session = typeof window !== "undefined" ? getStoredAuthSession() : null;

  const deliveriesQuery = useQuery({
    queryKey: ["delivery-agent", "orders"],
    queryFn: () => createAuthenticatedApiClient().get<DeliveryItem[]>("/delivery/me"),
    enabled: hasSession,
    refetchInterval: 15_000,
  });
  const notificationsQuery = useQuery({
    queryKey: ["delivery-agent", "notifications"],
    queryFn: () => createAuthenticatedApiClient().get<AppNotification[]>("/delivery/me/notifications"),
    enabled: hasSession,
    refetchInterval: 10_000,
  });
  const routeQuery = useQuery({
    queryKey: ["delivery-agent", "route"],
    queryFn: () => createAuthenticatedApiClient().get<DriverRoute | null>("/delivery/me/route"),
    enabled: hasSession,
    refetchInterval: 15_000,
  });
  const depotQuery = useQuery({
    queryKey: ["delivery-agent", "depot"],
    queryFn: () => createAuthenticatedApiClient().get<DepotResponse | null>("/delivery/me/depot"),
    enabled: hasSession,
    staleTime: 60_000,
  });
  const currentConfigQuery = useQuery({
    queryKey: ["delivery-agent", "current-config"],
    queryFn: getCurrentVerticalConfig,
    enabled: hasSession,
    staleTime: 60_000,
  });
  const updateStatus = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: DeliveryStatus; notes?: string }) => {
      await sendCurrentDriverLocation().catch(() => undefined);
      return createAuthenticatedApiClient().put(`/delivery/${id}/status`, {
        status,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["delivery-agent", "orders"] }),
        queryClient.invalidateQueries({ queryKey: ["delivery-agent", "notifications"] }),
      ]);
      notify("Status updated.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Status update failed.", "red"),
  });
  const uploadProof = useMutation({
    mutationFn: async ({ delivery, file, proofType }: { delivery: DeliveryItem; file: File; proofType: ProofType }) => {
      if (isLimitedProofType(proofType) && proofCount(delivery, proofType) > 0) {
        throw new Error(proofType === "DELIVERY_PHOTO" ? "Delivery proof photo is already uploaded." : "Payment screenshot is already uploaded.");
      }
      const location = await currentLocation().catch(() => null);
      const proofFile = await compressProofImage(file);
      const form = new FormData();
      form.append("file", proofFile);
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
      await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "orders"] });
      notify("Proof uploaded.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Proof upload failed.", "red"),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/delivery/notifications/${id}/read`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["delivery-agent", "notifications"] }),
  });
  const startRoute = useMutation({
    mutationFn: async () => {
      await sendCurrentDriverLocation().catch(() => undefined);
      return createAuthenticatedApiClient().post("/delivery/me/route/start", {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "route"] });
      notify("Route started.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Unable to start route.", "red"),
  });

  const deliveries = deliveriesQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const unread = notifications.filter((notification) => !notification.isRead);
  const activeDeliveries = deliveries.filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status));
  const completedDeliveries = deliveries.filter((delivery) => delivery.status === "DELIVERED" && isToday(delivery.deliveredAt));
  const driverRoute = routeQuery.data;
  const depotCoordinates = depotLocationCoordinates(depotQuery.data);
  const depotMapUrl = depotCoordinates ? googleMapsUrl(depotCoordinates) : null;
  const totalCash = useMemo(
    () => activeDeliveries.reduce((sum, delivery) => sum + Number(delivery.invoice?.amountDue ?? delivery.invoice?.grandTotal ?? 0), 0),
    [activeDeliveries],
  );

  useEffect(() => {
    setNotificationPermission(getBrowserNotificationPermission());
    setSoundAlertsEnabled(readSoundAlertsEnabled());
  }, []);

  useEffect(() => {
    if (currentConfigQuery.data?.tenant) {
      storeTenant(currentConfigQuery.data.tenant);
    }
  }, [currentConfigQuery.data?.tenant]);

  useEffect(() => {
    if (!notificationsInitialized.current) {
      for (const notification of unread) {
        notifiedIds.current.add(notification.id);
      }
      notificationsInitialized.current = true;
      return;
    }

    for (const notification of unread) {
      if (notifiedIds.current.has(notification.id)) continue;
      notifiedIds.current.add(notification.id);
      if (notificationPermission === "granted") {
        showBrowserNotification(notification);
      }
      if (soundAlertsEnabled && isDeliveryAssignmentAlert(notification)) {
        void playDeliveryAlert(alertAudioContext).catch(() => undefined);
      }
    }
  }, [notificationPermission, soundAlertsEnabled, unread]);

  useEffect(() => {
    if (!hasSession) return;

    void sendCurrentDriverLocation().catch(() => undefined);
    const interval = window.setInterval(() => {
      void sendCurrentDriverLocation().catch(() => undefined);
    }, 180_000);

    return () => window.clearInterval(interval);
  }, [hasSession]);

  function notify(nextMessage: string, tone: "green" | "red" = "green") {
    setMessage(nextMessage);
    setMessageTone(tone);
  }

  async function enableAlerts() {
    await enableSoundAlerts(alertAudioContext);
    setSoundAlertsEnabled(true);
    const notificationApi = getNotificationApi();
    if (!notificationApi) {
      setNotificationPermission("unsupported");
      notify("Sound alerts enabled. Browser notifications are not available here.");
      return;
    }

    try {
      const permission = await notificationApi.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        notify("Alerts enabled with ringtone.");
      } else if (permission === "denied") {
        notify("Ringtone enabled. Browser alerts are blocked in this browser.", "red");
      }
    } catch {
      setNotificationPermission("unsupported");
      notify("Ringtone enabled. Browser alerts are not available here.");
    }
  }

  async function handleLogout() {
    await logout();
    window.location.href = "/login";
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
        <div className="mx-auto max-w-sm">
          <div className="text-sm font-semibold text-emerald-300">BizBil Delivery</div>
          <h1 className="mt-3 text-3xl font-bold">Sign in to view assigned orders.</h1>
          <p className="mt-3 text-sm text-slate-300">Use the same shop slug, email, and password created for the delivery user in BizBil settings.</p>
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
            <div className="truncate text-sm font-semibold">{currentConfigQuery.data?.tenant.name ?? tenant?.name ?? "Shop delivery"}</div>
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
              void sendCurrentDriverLocation().catch(() => undefined);
              void deliveriesQuery.refetch();
              void notificationsQuery.refetch();
            }}
          >
            <RefreshCcw className="size-4" aria-hidden="true" />
            Sync
          </button>
          {depotMapUrl ? (
            <a className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800" href={depotMapUrl} target="_blank" rel="noreferrer">
              <MapPin className="size-4" aria-hidden="true" />
              Depot
            </a>
          ) : null}
          <button className={`h-9 rounded-md border px-3 text-xs font-semibold ${soundAlertsEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`} onClick={() => void enableAlerts()}>
            Alerts: {soundAlertsEnabled ? "Sound on" : notificationPermission}
          </button>
        </div>
        {message ? (
          <div className={cn("rounded-md border px-3 py-2 text-sm", messageTone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700")}>{message}</div>
        ) : null}
        {deliveriesQuery.error || notificationsQuery.error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {(deliveriesQuery.error ?? notificationsQuery.error)?.message}
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

      {driverRoute ? (
        <section className="mt-4 space-y-2 px-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Published route</div>
              <div className="mt-0.5 text-sm font-semibold">{driverRoute.routePlan?.name ?? "Route"}</div>
            </div>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-50"
              disabled={startRoute.isPending || driverRoute.status === "IN_PROGRESS"}
              onClick={() => startRoute.mutate()}
            >
              <Navigation className="size-4" aria-hidden="true" />
              Start
            </button>
          </div>
          <div className="space-y-2">
            {driverRoute.stops.map((stop) => {
              const delivery = stop.delivery;
              const address = delivery?.deliveryAddress ?? "";
              const coordinates = delivery ? deliveryCoordinates(delivery) : null;
              const mapQuery = coordinates ? `${coordinates.latitude.toString()},${coordinates.longitude.toString()}` : address;
              const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
              const appleUrl = `https://maps.apple.com/?q=${encodeURIComponent(mapQuery)}`;
              return (
                <article key={stop.id} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-sm font-bold text-emerald-700">{stop.sequence}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-mono text-xs text-slate-500">{delivery?.invoice?.invoiceNumber ?? stop.id}</div>
                        <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{stop.status.replaceAll("_", " ")}</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold">{delivery?.customer?.name ?? "Customer"}</div>
                      <div className="mt-1 text-xs text-slate-500">{address}</div>
                      {coordinates ? (
                        <div className="mt-1 font-mono text-[11px] text-emerald-700">
                          Pin {coordinates.latitude.toFixed(7)}, {coordinates.longitude.toFixed(7)}
                        </div>
                      ) : null}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <a className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 text-xs font-semibold text-slate-700" href={googleUrl} target="_blank" rel="noreferrer">
                          <MapPin className="size-4" aria-hidden="true" />
                          Google Maps
                        </a>
                        <a className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 text-xs font-semibold text-slate-700" href={appleUrl} target="_blank" rel="noreferrer">
                          <Navigation className="size-4" aria-hidden="true" />
                          Apple Maps
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mt-4 space-y-3 px-3 pb-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned orders</div>
        {activeDeliveries.map((delivery) => (
          <DeliveryCard
            key={delivery.id}
            delivery={delivery}
            proofNotes={proofNotes}
            setProofNotes={setProofNotes}
            updating={updateStatus.isPending}
            uploading={uploadProof.isPending}
            onStatus={(status, notes) => updateStatus.mutate({ id: delivery.id, status, ...(notes ? { notes } : {}) })}
            onProof={(file, proofType) => uploadProof.mutate({ delivery, file, proofType })}
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
  onStatus,
  onProof,
}: Readonly<{
  delivery: DeliveryItem;
  proofNotes: Record<string, string>;
  setProofNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  updating: boolean;
  uploading: boolean;
  onStatus: (status: DeliveryStatus, notes?: string) => void;
  onProof: (file: File, proofType: ProofType) => void;
}>) {
  const deliveryPhotoCount = delivery.proofs?.filter((proof) => proof.proofType === "DELIVERY_PHOTO").length ?? 0;
  const paymentProofCount = delivery.proofs?.filter((proof) => proof.proofType === "PAYMENT_SCREENSHOT").length ?? 0;
  const hasDeliveryPhoto = deliveryPhotoCount > 0;
  const hasPaymentProof = paymentProofCount > 0;
  const coordinates = deliveryCoordinates(delivery);
  const mapQuery = coordinates ? `${coordinates.latitude.toString()},${coordinates.longitude.toString()}` : delivery.deliveryAddress;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
  const customerPhone = delivery.customer?.phone ?? "";
  const deliveryNote = proofNotes[proofNoteKey(delivery.id, "DELIVERY_PHOTO")] ?? "";

  return (
    <article className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-xs text-slate-500">{delivery.invoice?.invoiceNumber ?? delivery.id}</div>
            <div className="mt-1 text-lg font-bold">₹{Number(delivery.invoice?.grandTotal ?? 0).toFixed(2)}</div>
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
          {coordinates ? (
            <a className="inline-flex items-center gap-2 font-mono text-xs text-emerald-700" href={mapUrl} target="_blank" rel="noreferrer">
              <MapPin className="size-4" aria-hidden="true" />
              {coordinates.latitude.toFixed(7)}, {coordinates.longitude.toFixed(7)}
            </a>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <ProofInput
            label={hasDeliveryPhoto ? "Delivery photo uploaded" : "Delivery photo"}
            proofType="DELIVERY_PHOTO"
            disabled={uploading || hasDeliveryPhoto}
            onProof={onProof}
          />
          <ProofInput
            label={hasPaymentProof ? "Payment screenshot uploaded" : "Payment screenshot"}
            proofType="PAYMENT_SCREENSHOT"
            disabled={uploading || hasPaymentProof}
            onProof={onProof}
          />
        </div>

        <input
          value={deliveryNote}
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
            disabled={updating}
            title="Mark delivered"
            onClick={() => onStatus("DELIVERED", deliveryNote)}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Delivered
          </button>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={updating} onClick={() => onStatus("FAILED", deliveryNote)}>
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

function isLimitedProofType(proofType: ProofType): boolean {
  return proofType === "DELIVERY_PHOTO" || proofType === "PAYMENT_SCREENSHOT";
}

function proofCount(delivery: DeliveryItem, proofType: ProofType): number {
  return delivery.proofs?.filter((proof) => proof.proofType === proofType).length ?? 0;
}

async function compressProofImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image proof files are allowed.");
  }

  const image = await loadImage(file);
  const scale = Math.min(1, PROOF_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare proof image.");
  }

  context.drawImage(image, 0, 0, width, height);
  URL.revokeObjectURL(image.src);
  let blob: Blob | null = null;
  for (const quality of PROOF_IMAGE_QUALITY_STEPS) {
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob.size <= PROOF_IMAGE_MAX_UPLOAD_BYTES) {
      break;
    }
  }

  if (!blob || blob.size > PROOF_IMAGE_MAX_UPLOAD_BYTES) {
    throw new Error("Proof image is still too large after compression. Please choose a smaller image.");
  }

  return new File([blob], replaceImageExtension(file.name), { type: "image/jpeg", lastModified: Date.now() });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new Error("Unable to read proof image."));
    };
    image.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to compress proof image."));
        return;
      }

      resolve(blob);
    }, type, quality);
  });
}

function replaceImageExtension(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  return `${baseName || "delivery-proof"}.jpg`;
}

function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
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

function deliveryCoordinates(delivery: DeliveryItem): { latitude: number; longitude: number } | null {
  const latitude = Number(delivery.customerLocation?.latitude ?? delivery.customer?.locations?.[0]?.latitude ?? delivery.deliveryLatitude);
  const longitude = Number(delivery.customerLocation?.longitude ?? delivery.customer?.locations?.[0]?.longitude ?? delivery.deliveryLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function depotLocationCoordinates(depot: DepotResponse | null | undefined): { latitude: number; longitude: number } | null {
  const latitude = Number(depot?.depotLatitude);
  const longitude = Number(depot?.depotLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function googleMapsUrl(coordinates: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps?q=${coordinates.latitude.toString()},${coordinates.longitude.toString()}`;
}

async function sendCurrentDriverLocation(): Promise<void> {
  const location = await currentLocation();
  await createAuthenticatedApiClient().post("/delivery/me/location", location);
}

function proofNoteKey(deliveryId: string, proofType: ProofType): string {
  return `${deliveryId}:${proofType}`;
}

function readSoundAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DELIVERY_ALERT_SOUND_KEY) === "true";
}

async function enableSoundAlerts(audioContextRef: React.MutableRefObject<AudioContext | null>): Promise<void> {
  window.localStorage.setItem(DELIVERY_ALERT_SOUND_KEY, "true");
  const context = getAlertAudioContext(audioContextRef);
  if (context.state === "suspended") {
    await context.resume();
  }

  await playDeliveryAlert(audioContextRef, { preview: true });
}

function isDeliveryAssignmentAlert(notification: AppNotification): boolean {
  return notification.type === "DELIVERY_ASSIGNED" || notification.title.toLowerCase().includes("delivery");
}

async function playDeliveryAlert(audioContextRef: React.MutableRefObject<AudioContext | null>, options: { preview?: boolean } = {}): Promise<void> {
  const context = getAlertAudioContext(audioContextRef);
  if (context.state === "suspended") {
    await context.resume();
  }

  const now = context.currentTime;
  const pattern = options.preview ? [0] : [0, 0.38, 0.76, 1.14, 1.52, 1.9];
  for (const [index, offset] of pattern.entries()) {
    const frequency = index % 2 === 0 ? 1040 : 780;
    scheduleAlarmBeep(context, now + offset, frequency);
  }
}

function getAlertAudioContext(audioContextRef: React.MutableRefObject<AudioContext | null>): AudioContext {
  if (!audioContextRef.current) {
    const audioWindow = window as WebkitAudioWindow;
    const AudioContextConstructor = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Audio alerts are not available in this browser.");
    }
    audioContextRef.current = new AudioContextConstructor();
  }

  return audioContextRef.current;
}

function scheduleAlarmBeep(context: AudioContext, startAt: number, frequency: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.42, startAt + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.26);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.28);
}

function getNotificationApi(): typeof Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return window.Notification;
}

function getBrowserNotificationPermission(): NotificationPermission | "unsupported" {
  const notificationApi = getNotificationApi();
  if (!notificationApi) return "unsupported";

  try {
    return notificationApi.permission;
  } catch {
    return "unsupported";
  }
}

function showBrowserNotification(notification: AppNotification): void {
  const notificationApi = getNotificationApi();
  if (!notificationApi || notificationApi.permission !== "granted") return;

  try {
    new notificationApi(notification.title, { body: notification.body, tag: notification.id });
  } catch {
    // Some mobile/PWA contexts expose Notification but reject direct construction.
  }
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
        ...(Number.isFinite(position.coords.accuracy) ? { accuracy: position.coords.accuracy } : {}),
      }),
      reject,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    );
  });
}
