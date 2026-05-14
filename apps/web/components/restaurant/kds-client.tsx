"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Clock, Play, RefreshCw, Utensils, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiUrl, createAuthenticatedApiClient, refreshAuthSession } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type KotStatus = "PENDING" | "PREPARING";

interface KdsItem {
  productName: string;
  quantity: number;
  modifiers: unknown[];
  notes: string | null;
}

interface KdsKot {
  id: string;
  kotNumber: string;
  tableNumber: string;
  status: KotStatus;
  createdAt: string;
  elapsedMinutes: number;
  items: KdsItem[];
}

export function KdsClient() {
  const [kots, setKots] = useState<KdsKot[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "PREPARING" | "READY" }) => {
      const api = createAuthenticatedApiClient();
      if (status === "READY") {
        return api.post(`/restaurant/kots/${id}/bump`, {});
      }

      return api.put(`/restaurant/kots/${id}/status`, { status });
    },
  });

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;

    async function connect() {
      await refreshAuthSession().catch(() => undefined);
      if (closed) {
        return;
      }

      source = new EventSource(apiUrl("/restaurant/kds/live"), { withCredentials: true });
      source.addEventListener("kds", (event) => {
        const message = event as MessageEvent<string>;
        const payload = JSON.parse(message.data) as KdsKot[];
        setKots(payload);
        setConnected(true);
        setError(null);
      });
      source.onerror = () => {
        setConnected(false);
        setError("Live kitchen feed is reconnecting.");
      };
    }

    void connect();

    return () => {
      closed = true;
      source?.close();
    };
  }, []);

  const summary = useMemo(() => {
    const pending = kots.filter((kot) => kot.status === "PENDING").length;
    const preparing = kots.filter((kot) => kot.status === "PREPARING").length;
    const urgent = kots.filter((kot) => kot.elapsedMinutes >= 10).length;
    return { pending, preparing, urgent, total: kots.length };
  }, [kots]);

  return (
    <div className="min-h-[calc(100vh-7rem)] rounded-md border border-border bg-slate-950 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-emerald-700 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-100">
            <Utensils className="size-4" aria-hidden="true" />
            Kitchen Display
          </div>
          <h1 className="mt-1 text-2xl font-bold">Live KOT board</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusPill label="Pending" value={summary.pending} tone="amber" />
          <StatusPill label="Preparing" value={summary.preparing} tone="blue" />
          <StatusPill label="Urgent" value={summary.urgent} tone="red" />
          <span className={cn("inline-flex h-9 items-center gap-2 rounded-md border px-3", connected ? "border-emerald-300 bg-emerald-500/15 text-emerald-50" : "border-red-300 bg-red-500/15 text-red-50")}>
            {connected ? <RefreshCw className="size-4" aria-hidden="true" /> : <WifiOff className="size-4" aria-hidden="true" />}
            {connected ? "Live" : "Retrying"}
          </span>
        </div>
      </div>

      {error ? <div className="border-b border-amber-400/30 bg-amber-500/10 px-5 py-2 text-sm text-amber-100">{error}</div> : null}

      <div className="p-5">
        {kots.length === 0 ? (
          <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-white/20 bg-white/5 text-center">
            <div>
              <Clock className="mx-auto size-8 text-emerald-200" aria-hidden="true" />
              <p className="mt-3 text-lg font-semibold">No active kitchen orders</p>
              <p className="mt-1 text-sm text-slate-300">Pending and preparing KOTs will appear here automatically.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {kots.map((kot) => (
              <KotCard
                key={kot.id}
                kot={kot}
                busy={mutation.isPending}
                onStart={() => mutation.mutate({ id: kot.id, status: "PREPARING" })}
                onDone={() => mutation.mutate({ id: kot.id, status: "READY" })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KotCard({
  kot,
  busy,
  onStart,
  onDone,
}: Readonly<{
  kot: KdsKot;
  busy: boolean;
  onStart: () => void;
  onDone: () => void;
}>) {
  const urgency = kot.elapsedMinutes >= 10 ? "red" : kot.elapsedMinutes >= 5 ? "amber" : "green";

  return (
    <article className={cn("overflow-hidden rounded-md border bg-white text-slate-950 shadow-sm", urgency === "red" && "border-red-400", urgency === "amber" && "border-amber-300", urgency === "green" && "border-emerald-300")}>
      <div className={cn("flex items-start justify-between gap-3 border-b px-4 py-3", urgency === "red" && "bg-red-50", urgency === "amber" && "bg-amber-50", urgency === "green" && "bg-emerald-50")}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kot.kotNumber}</div>
          <div className="mt-1 text-xl font-bold">Table {kot.tableNumber}</div>
        </div>
        <div className="text-right">
          <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-bold", kot.status === "PENDING" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800")}>
            {kot.status}
          </span>
          <div className={cn("mt-2 flex items-center justify-end gap-1 text-sm font-semibold", urgency === "red" && "text-red-700", urgency === "amber" && "text-amber-700", urgency === "green" && "text-emerald-700")}>
            <Clock className="size-4" aria-hidden="true" />
            {kot.elapsedMinutes} min
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {kot.items.map((item, index) => (
          <div key={`${kot.id}-${item.productName}-${String(index)}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="font-semibold">{item.productName}</div>
              <div className="rounded bg-slate-100 px-2 py-1 text-sm font-bold">x {item.quantity}</div>
            </div>
            {item.modifiers.length > 0 ? (
              <div className="mt-1 text-xs text-slate-500">{item.modifiers.map(formatModifier).filter(Boolean).join(", ")}</div>
            ) : null}
            {item.notes ? <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{item.notes}</div> : null}
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        {kot.status === "PENDING" ? (
          <button
            type="button"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={busy}
            onClick={onStart}
          >
            <Play className="size-4" aria-hidden="true" />
            Start
          </button>
        ) : (
          <button
            type="button"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            disabled={busy}
            onClick={onDone}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Done
          </button>
        )}
      </div>
    </article>
  );
}

function StatusPill({ label, value, tone }: Readonly<{ label: string; value: number; tone: "amber" | "blue" | "red" }>) {
  const toneClass = {
    amber: "border-amber-200 bg-amber-400/15 text-amber-50",
    blue: "border-blue-200 bg-blue-400/15 text-blue-50",
    red: "border-red-200 bg-red-400/15 text-red-50",
  }[tone];

  return (
    <span className={cn("inline-flex h-9 items-center gap-2 rounded-md border px-3", toneClass)}>
      <span className="text-xs uppercase tracking-wide opacity-80">{label}</span>
      <span className="text-base font-bold">{value}</span>
    </span>
  );
}

function formatModifier(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const groupName = typeof record.groupName === "string" ? record.groupName : "";
  const optionName = typeof record.optionName === "string" ? record.optionName : "";
  return [groupName, optionName].filter(Boolean).join(": ");
}
