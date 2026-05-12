"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";

import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";

interface PaymentRecord {
  id: string;
  amount: string | number;
  mode: string;
  referenceNumber?: string | null;
  paidAt: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    amountDue: string | number;
    grandTotal: string | number;
    customer?: {
      name: string;
      phone: string;
    } | null;
  };
}

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  amountDue: string | number;
  grandTotal: string | number;
  status: string;
  customer?: {
    name: string;
    phone: string;
  } | null;
}

type PaymentRangePreset = "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "THIS_MONTH" | "CUSTOM";

const PAYMENT_RANGE_OPTIONS: Array<{ label: string; value: PaymentRangePreset }> = [
  { label: "Today", value: "TODAY" },
  { label: "Yesterday", value: "YESTERDAY" },
  { label: "7 days", value: "LAST_7_DAYS" },
  { label: "This month", value: "THIS_MONTH" },
  { label: "Custom", value: "CUSTOM" },
];

export function PaymentsClient() {
  const queryClient = useQueryClient();
  const todayInput = useMemo(() => dateInputValue(new Date()), []);
  const [rangePreset, setRangePreset] = useState<PaymentRangePreset>("TODAY");
  const [customFrom, setCustomFrom] = useState(todayInput);
  const [customTo, setCustomTo] = useState(todayInput);
  const paymentRange = useMemo(
    () => getPaymentRange(rangePreset, customFrom, customTo),
    [customFrom, customTo, rangePreset],
  );
  const paymentRangeQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", paymentRange.from.toISOString());
    params.set("to", paymentRange.to.toISOString());
    return params.toString();
  }, [paymentRange.from, paymentRange.to]);
  const paymentsQuery = useQuery({
    queryKey: ["payments", paymentRange.from.toISOString(), paymentRange.to.toISOString()],
    queryFn: () => createAuthenticatedApiClient().get<PaymentRecord[]>(`/payments?${paymentRangeQuery}`),
  });
  const duesQuery = useQuery({
    queryKey: ["due-invoices"],
    queryFn: listAllDueInvoices,
  });
  const recordPayment = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/payments", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payments"] }),
        queryClient.invalidateQueries({ queryKey: ["due-invoices"] }),
      ]);
    },
  });
  const payments = paymentsQuery.data ?? [];
  const dueInvoices = duesQuery.data ?? [];
  const totals = payments.reduce<Record<string, number>>(
    (accumulator, payment) => {
      const amount = Number(payment.amount);
      accumulator[payment.mode] = (accumulator[payment.mode] ?? 0) + amount;
      return accumulator;
    },
    {},
  );
  const dueTotal = dueInvoices.reduce((total, invoice) => total + Number(invoice.amountDue), 0);
  const error = paymentsQuery.error ?? duesQuery.error ?? recordPayment.error;

  function handlePayment(event: React.SyntheticEvent<HTMLFormElement>, invoiceId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    recordPayment.mutate({
      invoiceId,
      amount: Number(form.get("amount")),
      mode: formString(form, "mode"),
      referenceNumber: formString(form, "referenceNumber") || undefined,
    });
  }

  return (
    <div className="space-y-4">
      <StatStrip
        items={[
          { label: "Cash", value: money(totals.CASH ?? 0), tone: "slate" },
          { label: "UPI", value: money(totals.UPI ?? 0), tone: "emerald" },
          { label: "Card", value: money(totals.CARD ?? 0), tone: "blue" },
          { label: "Credit due", value: money(dueTotal), tone: "amber" },
        ]}
      />
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-md border border-border bg-white">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-950">Recent payments</div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatRangeLabel(paymentRange.from, paymentRange.to)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {PAYMENT_RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRangePreset(option.value)}
                    className={`h-8 rounded-md border px-3 text-xs font-medium transition ${
                      rangePreset === option.value
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                        : "border-border bg-white text-slate-600 hover:border-emerald-200 hover:text-emerald-700"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {rangePreset === "CUSTOM" ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm text-slate-900"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm text-slate-900"
                  />
                </label>
              </div>
            ) : null}
          </div>
          <div className="divide-y divide-border">
            {payments.length > 0 ? payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-950">{payment.invoice.invoiceNumber}</div>
                  <div className="text-xs text-slate-500">{payment.mode} | {new Date(payment.paidAt).toLocaleString("en-IN")}</div>
                </div>
                <div className="text-sm font-semibold text-slate-900">{money(Number(payment.amount))}</div>
              </div>
            )) : <div className="p-4 text-sm text-slate-500">No payments recorded yet.</div>}
          </div>
        </section>
        <section className="rounded-md border border-border bg-white">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Outstanding dues</div>
          <div className="divide-y divide-border">
            {dueInvoices.length > 0 ? dueInvoices.map((invoice) => (
              <div key={invoice.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-950">{invoice.invoiceNumber}</div>
                    <div className="text-xs text-slate-500">{invoice.customer?.name ?? "Walk-in"} | Due {money(Number(invoice.amountDue))}</div>
                  </div>
                </div>
                <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]" onSubmit={(event) => handlePayment(event, invoice.id)}>
                  <input name="amount" type="number" step="0.01" max={Number(invoice.amountDue)} placeholder="Amount" className="h-9 rounded-md border border-border px-3 text-sm" required />
                  <select name="mode" className="h-9 rounded-md border border-border px-3 text-sm">
                    {["CASH", "UPI", "CARD", "NETBANKING"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                  </select>
                  <input name="referenceNumber" placeholder="Reference" className="h-9 rounded-md border border-border px-3 text-sm" />
                  <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white" disabled={recordPayment.isPending}>
                    <Save className="size-4" aria-hidden="true" />
                    Record
                  </button>
                </form>
              </div>
            )) : <div className="p-4 text-sm text-slate-500">No outstanding dues.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function getPaymentRange(preset: PaymentRangePreset, customFrom: string, customTo: string): { from: Date; to: Date } {
  const today = new Date();

  if (preset === "YESTERDAY") {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  }

  if (preset === "LAST_7_DAYS") {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { from: startOfDay(from), to: endOfDay(today) };
  }

  if (preset === "THIS_MONTH") {
    return { from: startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: endOfDay(today) };
  }

  if (preset === "CUSTOM") {
    const from = localDateFromInput(customFrom, false);
    const to = localDateFromInput(customTo, true);
    return from <= to ? { from, to } : { from: startOfDay(to), to: endOfDay(from) };
  }

  return { from: startOfDay(today), to: endOfDay(today) };
}

function localDateFromInput(value: string, isEndOfDay: boolean): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return isEndOfDay ? endOfDay(new Date()) : startOfDay(new Date());
  }

  return isEndOfDay ? endOfDay(new Date(year, month - 1, day)) : startOfDay(new Date(year, month - 1, day));
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRangeLabel(from: Date, to: Date): string {
  const formatter = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return `${formatter.format(from)} - ${formatter.format(to)}`;
}

async function listAllDueInvoices(): Promise<InvoiceRecord[]> {
  const api = createAuthenticatedApiClient();
  const limit = 100;
  const invoices: InvoiceRecord[] = [];
  let page = 1;
  let total = 0;

  do {
    const response = await api.get<{ data: InvoiceRecord[]; total: number }>(`/billing/invoices?unpaid=true&page=${String(page)}&limit=${String(limit)}`);
    invoices.push(...response.data);
    total = response.total;
    page += 1;
  } while (invoices.length < total);

  return invoices;
}
