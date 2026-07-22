"use client";

import { CreditCard, Loader2, RefreshCcw, ShieldCheck, Smartphone, X } from "lucide-react";

export interface PhonePeAttemptView {
  id: string;
  channel: "card" | "upi";
  amount: number;
  status: "pending" | "success" | "failed" | "expired" | "manual_override";
  provider_state: string | null;
  reference_number: string | null;
  response_code: string | null;
  qr_data_url: string | null;
  external_transaction_id: string;
  manual_override_allowed: boolean;
  message: string;
}

export function PhonePePaymentDialog({
  methodName,
  attempt,
  syncing,
  completingInvoice,
  manualReference,
  manualReason,
  manualOverridePending,
  canManualOverride,
  onManualReferenceChange,
  onManualReasonChange,
  onRefresh,
  onManualOverride,
  onClose,
}: Readonly<{
  methodName: string;
  attempt: PhonePeAttemptView;
  syncing: boolean;
  completingInvoice: boolean;
  manualReference: string;
  manualReason: string;
  manualOverridePending: boolean;
  canManualOverride: boolean;
  onManualReferenceChange: (value: string) => void;
  onManualReasonChange: (value: string) => void;
  onRefresh: () => void;
  onManualOverride: () => void;
  onClose: () => void;
}>) {
  const badgeTone = attempt.status === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : attempt.status === "failed" || attempt.status === "expired"
      ? "border-red-200 bg-red-50 text-red-700"
      : attempt.status === "manual_override"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">PhonePe payment</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-950">
              {attempt.channel === "card" ? <CreditCard className="size-5 text-sky-600" /> : <Smartphone className="size-5 text-violet-600" />}
              <span>{methodName}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500">Amount Rs {attempt.amount.toFixed(2)}</div>
          </div>
          <button className="rounded p-2 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close PhonePe dialog">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${badgeTone}`}>
            {attempt.status.replace("_", " ")}
          </div>

          <div className="rounded-xl border border-border bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">{attempt.message}</div>
            <div className="mt-2 text-xs text-slate-500">Transaction ID: {attempt.external_transaction_id}</div>
            {attempt.provider_state ? <div className="mt-1 text-xs text-slate-500">PhonePe state: {attempt.provider_state}</div> : null}
            {attempt.reference_number ? <div className="mt-1 text-xs font-semibold text-emerald-700">Reference: {attempt.reference_number}</div> : null}
            {attempt.response_code ? <div className="mt-1 text-xs text-slate-500">Response code: {attempt.response_code}</div> : null}
          </div>

          {attempt.channel === "upi" && attempt.qr_data_url ? (
            <div className="rounded-xl border border-border bg-white p-4 text-center">
              <img src={attempt.qr_data_url} alt="PhonePe QR" className="mx-auto size-56 rounded-lg border border-slate-200" />
              <div className="mt-3 text-sm text-slate-600">Ask the customer to scan this QR and complete the payment, then BizBil will verify it with PhonePe.</div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-slate-700 disabled:opacity-50" onClick={onRefresh} disabled={syncing || completingInvoice}>
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              Refresh status
            </button>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 disabled:opacity-50" onClick={onClose} disabled={completingInvoice}>
              {completingInvoice ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {completingInvoice ? "Saving invoice..." : "Close"}
            </button>
          </div>

          {attempt.manual_override_allowed && canManualOverride ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">Manual override</div>
              <div className="mt-1 text-xs text-amber-800">Use this only if the customer has already paid and the terminal or callback has not updated BizBil yet.</div>
              <div className="mt-3 grid gap-3">
                <label className="block text-sm font-medium text-slate-700">
                  Reference number
                  <input value={manualReference} onChange={(event) => onManualReferenceChange(event.target.value)} placeholder="RRN / UTR / PhonePe reference" className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Reason (optional)
                  <input value={manualReason} onChange={(event) => onManualReasonChange(event.target.value)} placeholder="Customer showed successful payment" className="mt-1 h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm" />
                </label>
                <button className="inline-flex h-10 items-center justify-center rounded-md bg-amber-600 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={onManualOverride} disabled={!manualReference.trim() || manualOverridePending || completingInvoice}>
                  {manualOverridePending ? "Recording override..." : "Record manual override"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
