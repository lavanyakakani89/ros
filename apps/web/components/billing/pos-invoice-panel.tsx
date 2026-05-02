"use client";

import { Plus, Receipt, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useBillingStore } from "@/lib/billing-store";
import { createAuthenticatedApiClient, refreshAuthSession } from "@/lib/api-client";
import { getPendingInvoiceCounts, queueInvoice, syncPendingInvoices } from "@/lib/offline-queue";
import { hasStoredAuthSession } from "@/lib/vertical-config";

export function PosInvoicePanel() {
  const { lines, setLine, addLine, removeLine, reset } = useBillingStore();
  const [online, setOnline] = useState(true);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, syncing: 0, failed: 0 });
  const [status, setStatus] = useState<string | null>(null);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.sellingPrice, 0);
    const discount = lines.reduce((sum, line) => sum + line.discount, 0);
    const taxable = Math.max(subtotal - discount, 0);
    const gst = taxable * 0.12;
    return {
      subtotal,
      discount,
      cgst: gst / 2,
      sgst: gst / 2,
      grandTotal: taxable + gst,
    };
  }, [lines]);

  useEffect(() => {
    async function refreshCounts() {
      setQueueCounts(await getPendingInvoiceCounts());
    }

    function handleOnline() {
      setOnline(true);
      void syncNow();
    }

    function handleOffline() {
      setOnline(false);
    }

    setOnline(navigator.onLine);
    void refreshCounts();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function syncNow() {
    if (!hasStoredAuthSession()) {
      setStatus("Sign in before syncing queued invoices.");
      return;
    }

    await syncPendingInvoices(async () => {
      await refreshAuthSession();
      return createAuthenticatedApiClient();
    });
    setQueueCounts(await getPendingInvoiceCounts());
    setStatus("Offline queue synced.");
  }

  async function confirmInvoice() {
    const payload = {
      paymentMode: "CASH",
      items: lines
        .filter((line) => line.productId)
        .map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          discount: line.discount,
        })),
    };

    if (payload.items.length === 0) {
      setStatus("Enter product IDs before confirming or syncing.");
      return;
    }

    if (!online) {
      await queueInvoice(payload, "local-tenant");
      setQueueCounts(await getPendingInvoiceCounts());
      setStatus("Invoice queued offline.");
      reset();
      return;
    }

    if (!hasStoredAuthSession()) {
      await queueInvoice(payload, "local-tenant");
      setQueueCounts(await getPendingInvoiceCounts());
      setStatus("Invoice queued until sign in.");
      reset();
      return;
    }

    try {
      await createAuthenticatedApiClient().post("/billing/invoices", payload);
      setStatus("Invoice created.");
      reset();
    } catch {
      await queueInvoice(payload, "local-tenant");
      setQueueCounts(await getPendingInvoiceCounts());
      setStatus("Network issue. Invoice queued.");
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Receipt className="size-4 text-emerald-700" aria-hidden="true" />
            POS invoice
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border px-2 py-1 text-xs text-slate-600">{online ? "Online" : "Offline"}</span>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void syncNow()}>
              <RefreshCcw className="size-4" aria-hidden="true" />
              Sync
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white" onClick={addLine}>
              <Plus className="size-4" aria-hidden="true" />
              Line
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Product ID</th>
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Rate</th>
                <th className="px-3 py-3 font-medium">Discount</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-border">
                  <td className="px-3 py-2"><input className="h-9 w-44 rounded-md border border-border px-2" value={line.productId} onChange={(event) => setLine(line.id, { productId: event.target.value })} /></td>
                  <td className="px-3 py-2"><input className="h-9 w-48 rounded-md border border-border px-2" value={line.productName} onChange={(event) => setLine(line.id, { productName: event.target.value })} /></td>
                  <td className="px-3 py-2"><input className="h-9 w-20 rounded-md border border-border px-2" type="number" min="0" value={line.quantity} onChange={(event) => setLine(line.id, { quantity: Number(event.target.value) })} /></td>
                  <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.sellingPrice} onChange={(event) => setLine(line.id, { sellingPrice: Number(event.target.value) })} /></td>
                  <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.discount} onChange={(event) => setLine(line.id, { discount: Number(event.target.value) })} /></td>
                  <td className="px-3 py-2 text-right font-semibold">₹{(line.quantity * line.sellingPrice - line.discount).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => removeLine(line.id)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-950">Bill summary</div>
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>₹{totals.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>₹{totals.discount.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>CGST</span><span>₹{totals.cgst.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>SGST</span><span>₹{totals.sgst.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-border pt-3 text-lg font-semibold"><span>Total</span><span>₹{totals.grandTotal.toFixed(2)}</span></div>
        </div>
        <div className="mt-4 rounded-md border border-border bg-slate-50 p-3 text-xs text-slate-600">
          Pending {queueCounts.pending} • Syncing {queueCounts.syncing} • Failed {queueCounts.failed}
        </div>
        {status ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{status}</div> : null}
        <button className="mt-5 h-11 w-full rounded-md bg-emerald-600 text-sm font-semibold text-white" onClick={() => void confirmInvoice()}>Confirm invoice</button>
      </aside>
    </section>
  );
}
