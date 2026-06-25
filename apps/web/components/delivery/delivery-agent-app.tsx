"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Clock3, IndianRupee, MapPin, Navigation, Phone, RefreshCcw, UploadCloud, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { createAuthenticatedApiClient, logout } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getStoredAuthSession, getStoredTenant, hasStoredAuthSession } from "@/lib/vertical-config";

type DeliveryStatus = "PENDING" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED";
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
}

interface AppNotification {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export function DeliveryAgentApp() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"green" | "red">("green");
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const notifiedIds = useRef(new Set<string>());
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
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DeliveryStatus }) => createAuthenticatedApiClient().put(`/delivery/${id}/status`, { status }),
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
      await queryClient.invalidateQueries({ queryKey: ["delivery-agent", "orders"] });
      notify("Proof uploaded.");
    },
    onError: (error) => notify(error instanceof Error ? error.message : "Proof upload failed.", "red"),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/delivery/notifications/${id}/read`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["delivery-agent", "notifications"] }),
  });

  const deliveries = deliveriesQuery.data ?? [];
  const notifications = notificationsQuery.data ?? [];
  const unread = notifications.filter((notification) => !notification.isRead);
  const activeDeliveries = deliveries.filter((delivery) => ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(delivery.status));
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
              void deliveriesQuery.refetch();
              void notificationsQuery.refetch();
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
            onStatus={(status) => updateStatus.mutate({ id: delivery.id, status })}
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
  onStatus: (status: DeliveryStatus) => void;
  onProof: (file: File, proofType: ProofType) => void;
}>) {
  const deliveryPhotoCount = delivery.proofs?.filter((proof) => proof.proofType === "DELIVERY_PHOTO").length ?? 0;
  const paymentProofCount = delivery.proofs?.filter((proof) => proof.proofType === "PAYMENT_SCREENSHOT").length ?? 0;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.deliveryAddress)}`;
  const customerPhone = delivery.customer?.phone ?? "";

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

function currentLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not available"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      reject,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    );
  });
}
