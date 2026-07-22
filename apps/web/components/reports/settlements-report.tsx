"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface PartnerRecord {
  id: string;
  name: string;
}

interface PaymentMethodRecord {
  id: string;
  name: string;
  short_code: string;
  color: string;
  partner_id: string | null;
  settlement_frequency: string | null;
}

interface SettlementRecord {
  id: string;
  payment_method_id: string;
  payment_method: { id: string; name: string; short_code: string; color: string } | null;
  partner_id: string | null;
  partner: { id: string; name: string } | null;
  period_start: string;
  period_end: string;
  opening_balance: number;
  total_sales: number;
  total_refunds: number;
  net_amount: number;
  status: "draft" | "reviewed" | "settled";
  settled_at: string | null;
  settled_by: string | null;
  notes: string | null;
}

export function SettlementsReport() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setDate(1);
  const [partnerId, setPartnerId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [periodStart, setPeriodStart] = useState(monthStart.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(today);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const api = createAuthenticatedApiClient();
  const queryClient = useQueryClient();

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: () => api.get<PartnerRecord[]>("/partners"),
  });
  const methodsQuery = useQuery({
    queryKey: ["payment-methods", "settlements"],
    queryFn: () => api.get<PaymentMethodRecord[]>("/payment-methods"),
  });
  const settlementsQuery = useQuery({
    queryKey: ["settlements"],
    queryFn: () => api.get<SettlementRecord[]>("/settlements"),
  });

  const methods = methodsQuery.data ?? [];
  const partnerMethods = useMemo(() => methods.filter((method) => !partnerId || method.partner_id === partnerId), [methods, partnerId]);
  const selectedMethod = partnerMethods.find((method) => method.id === methodId) ?? partnerMethods[0] ?? null;
  const settlements = settlementsQuery.data ?? [];

  const createSettlement = useMutation({
    mutationFn: () => api.post<SettlementRecord>("/settlements", {
      payment_method_id: selectedMethod?.id ?? methodId,
      period_start: periodStart,
      period_end: periodEnd,
      notes: notes.trim() || null,
    }),
    onSuccess: async () => {
      setMessage("Settlement draft generated.");
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["settlements"] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "reviewed" | "settled" }) => api.patch<SettlementRecord>(`/settlements/${id}/status`, { status }),
    onSuccess: async (_, input) => {
      setMessage(input.status === "settled" ? "Settlement locked as settled." : "Settlement marked reviewed.");
      await queryClient.invalidateQueries({ queryKey: ["settlements"] });
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">Generate settlement</div>
        <div className="mt-4 grid gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Partner
            <select value={partnerId} onChange={(event) => {
              setPartnerId(event.target.value);
              setMethodId("");
            }} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              <option value="">All partners</option>
              {(partnersQuery.data ?? []).map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Payment method
            <select value={methodId || selectedMethod?.id || ""} onChange={(event) => setMethodId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              {partnerMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">Start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" /></label>
            <label className="block text-sm font-medium text-slate-700">End<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" /></label>
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm" />
          </label>
          <button className="h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => createSettlement.mutate()} disabled={!selectedMethod || createSettlement.isPending}>
            Generate draft
          </button>
          {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
        </div>
      </aside>

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SettlementMetric label="Current drafts" value={settlements.filter((item) => item.status === "draft").length} />
          <SettlementMetric label="Reviewed" value={settlements.filter((item) => item.status === "reviewed").length} />
          <SettlementMetric label="Settled" value={settlements.filter((item) => item.status === "settled").length} />
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Partner</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2 text-right">Net amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((settlement) => (
                <tr key={settlement.id} className="border-t border-border text-slate-700">
                  <td className="px-3 py-2">{settlement.partner?.name ?? "-"}</td>
                  <td className="px-3 py-2 font-medium">{settlement.payment_method?.name ?? settlement.payment_method_id}</td>
                  <td className="px-3 py-2">{settlement.period_start} to {settlement.period_end}</td>
                  <td className="px-3 py-2 text-right">{money(settlement.net_amount)}</td>
                  <td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-600">{settlement.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {settlement.status === "draft" ? <button className="mr-2 rounded-md border border-border px-3 py-1 text-xs font-semibold" onClick={() => updateStatus.mutate({ id: settlement.id, status: "reviewed" })}>Review</button> : null}
                    {settlement.status !== "settled" ? <button className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white" onClick={() => updateStatus.mutate({ id: settlement.id, status: "settled" })}>Settle</button> : <span className="text-xs text-slate-500">Locked</span>}
                  </td>
                </tr>
              ))}
              {settlements.length === 0 ? (
                <tr><td className="px-3 py-8 text-center text-slate-500" colSpan={6}>No settlements yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettlementMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function money(value: number) {
  return `Rs ${value.toFixed(2)}`;
}
