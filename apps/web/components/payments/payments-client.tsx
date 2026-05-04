"use client";

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

export function PaymentsClient() {
  const queryClient = useQueryClient();
  const paymentsQuery = useQuery({
    queryKey: ["payments"],
    queryFn: () => createAuthenticatedApiClient().get<PaymentRecord[]>("/payments"),
  });
  const duesQuery = useQuery({
    queryKey: ["due-invoices"],
    queryFn: () => createAuthenticatedApiClient().get<{ data: InvoiceRecord[] }>("/billing/invoices?limit=100"),
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
  const dueInvoices = (duesQuery.data?.data ?? []).filter((invoice) => Number(invoice.amountDue) > 0 && invoice.status !== "DRAFT" && invoice.status !== "CANCELLED");
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
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Recent payments</div>
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
