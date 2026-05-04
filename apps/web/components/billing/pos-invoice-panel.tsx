"use client";

import { useQuery } from "@tanstack/react-query";
import { BookMarked, MessageCircle, Pause, Plus, Printer, Receipt, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createAuthenticatedApiClient, listProducts, refreshAuthSession } from "@/lib/api-client";
import { useBillingStore } from "@/lib/billing-store";
import { getPendingInvoiceCounts, queueInvoice, syncPendingInvoices } from "@/lib/offline-queue";
import { hasStoredAuthSession } from "@/lib/vertical-config";

const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CREDIT", "NETBANKING"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

interface SplitEntry {
  mode: PaymentMode;
  amount: number;
}

export function PosInvoicePanel() {
  const { lines, setLine, addLine, removeLine, reset, holdBill, restoreHeld, deleteHeld, heldBills } = useBillingStore();
  const [online, setOnline] = useState(true);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, syncing: 0, failed: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"green" | "red">("green");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [splitEntries, setSplitEntries] = useState<SplitEntry[]>([{ mode: "CASH", amount: 0 }]);
  const [useSplit, setUseSplit] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<string>("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponInput, setCouponInput] = useState("");
  const [loyaltyRedeem, setLoyaltyRedeem] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [notes, setNotes] = useState("");

  const productsQuery = useQuery({
    queryKey: ["products", "billing"],
    queryFn: () => listProducts(),
  });
  const customersQuery = useQuery({
    queryKey: ["customers", "billing", customerSearch],
    queryFn: () =>
      createAuthenticatedApiClient().get<{ data: Array<{ id: string; name: string; phone: string; creditLimit?: number | null; outstandingDue?: number | null }> }>(
        `/customers?limit=20${customerSearch ? `&search=${encodeURIComponent(customerSearch)}` : ""}`,
      ),
  });
  const products = productsQuery.data?.data ?? [];
  const selectedCustomer = customersQuery.data?.data.find((c) => c.id === customerId) ?? null;

  const totals = useMemo(() => {
    const lineItems = lines.map((line) => {
      const taxable = Math.max(line.quantity * line.sellingPrice - line.discount, 0);
      const gstRate = line.gstRate;
      const lineGst = taxable * (gstRate / 100);
      return {
        subtotal: line.quantity * line.sellingPrice,
        discount: line.discount,
        taxable,
        cgst: Math.round((lineGst / 2) * 100) / 100,
        sgst: Math.round((lineGst / 2) * 100) / 100,
        total: Math.round((taxable + lineGst) * 100) / 100,
      };
    });
    const subtotal = lineItems.reduce((s, l) => s + l.subtotal, 0);
    const discount = lineItems.reduce((s, l) => s + l.discount, 0) + couponDiscount + loyaltyRedeem;
    const cgst = lineItems.reduce((s, l) => s + l.cgst, 0);
    const sgst = lineItems.reduce((s, l) => s + l.sgst, 0);
    const grandTotal = Math.max(lineItems.reduce((s, l) => s + l.total, 0) - couponDiscount - loyaltyRedeem, 0);
    return { subtotal, discount, cgst, sgst, grandTotal };
  }, [lines, couponDiscount, loyaltyRedeem]);

  // Load loyalty balance when customer selected
  useEffect(() => {
    if (!customerId) { setLoyaltyBalance(null); return; }
    createAuthenticatedApiClient()
      .get<{ points: number }>(`/loyalty/${customerId}`)
      .then((data) => setLoyaltyBalance(data.points))
      .catch(() => setLoyaltyBalance(null));
  }, [customerId]);

  useEffect(() => {
    async function refreshCounts() {
      setQueueCounts(await getPendingInvoiceCounts());
    }
    function handleOnline() { setOnline(true); void syncNow(); }
    function handleOffline() { setOnline(false); }
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
    if (!hasStoredAuthSession()) { setStatus("Sign in before syncing."); return; }
    await syncPendingInvoices(async () => {
      await refreshAuthSession();
      return createAuthenticatedApiClient();
    });
    setQueueCounts(await getPendingInvoiceCounts());
    notify("Offline queue synced.", "green");
  }

  function notify(msg: string, tone: "green" | "red" = "green") {
    setStatus(msg);
    setStatusTone(tone);
  }

  function handleBarcodeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !barcodeInput.trim()) return;
    const product = products.find((p) => p.barcode === barcodeInput.trim() || p.sku === barcodeInput.trim());
    if (!product) { notify(`No product found for "${barcodeInput}"`, "red"); setBarcodeInput(""); return; }
    const existing = lines.find((l) => l.productId === product.id);
    if (existing) {
      setLine(existing.id, { quantity: existing.quantity + 1 });
    } else {
      addLine();
      const newLine = useBillingStore.getState().lines.at(-1);
      if (!newLine) return;
      const newId = newLine.id;
      setLine(newId, {
        productId: product.id,
        productName: product.name,
        sellingPrice: decimalToNumber(product.sellingPrice),
        gstRate: decimalToNumber(product.gstRate),
      });
    }
    setBarcodeInput("");
  }

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    try {
      const result = await createAuthenticatedApiClient().post<{ discount: number }>("/coupons/validate", {
        code: couponInput.trim(),
        orderTotal: totals.grandTotal,
      });
      setCouponDiscount(result.discount);
      setAppliedCoupon(couponInput.trim());
      notify(`Coupon applied: -INR ${result.discount.toFixed(2)}`, "green");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Invalid coupon", "red");
    }
  }

  async function confirmInvoice() {
    const activeLines = lines.filter((l) => l.productId);
    if (activeLines.length === 0) { notify("Add at least one product.", "red"); return; }
    setPdfUrl(null);
    setLastInvoiceId(null);

    // Credit-limit check
    if (selectedCustomer) {
      const limit = selectedCustomer.creditLimit ?? 0;
      const outstanding = selectedCustomer.outstandingDue ?? 0;
      const primaryMode = useSplit ? splitEntries[0]?.mode : "CASH";
      if (primaryMode === "CREDIT" && limit > 0 && outstanding + totals.grandTotal > limit) {
        notify(`Credit limit exceeded. Outstanding: INR ${outstanding.toFixed(2)}, Limit: INR ${limit.toFixed(2)}`, "red");
        return;
      }
    }

    const paymentMode = useSplit ? splitEntries[0]?.mode ?? "CASH" : "CASH";
    const payload = {
      paymentMode,
      ...(customerId ? { customerId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(appliedCoupon ? { verticalData: { couponCode: appliedCoupon, couponDiscount } } : {}),
      items: activeLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discount: line.discount,
      })),
    };

    if (!online || !hasStoredAuthSession()) {
      await queueInvoice(payload, "local-tenant");
      setQueueCounts(await getPendingInvoiceCounts());
      notify(online ? "Invoice queued until sign in." : "Invoice queued offline.");
      reset(); setCouponDiscount(0); setAppliedCoupon(""); setLoyaltyRedeem(0);
      return;
    }

    try {
      const invoice = await createAuthenticatedApiClient().post<{ id: string }>("/billing/invoices", payload);
      await createAuthenticatedApiClient().post(`/billing/invoices/${invoice.id}/confirm`, {});

      // Record split payments if applicable
      if (useSplit) {
        for (const entry of splitEntries.filter((e) => e.amount > 0)) {
          await createAuthenticatedApiClient().post("/payments", {
            invoiceId: invoice.id,
            amount: entry.amount,
            mode: entry.mode,
          });
        }
      }

      // Redeem loyalty points
      if (loyaltyRedeem > 0 && customerId) {
        await createAuthenticatedApiClient().post("/loyalty/redeem", {
          customerId,
          invoiceId: invoice.id,
          points: Math.floor(loyaltyRedeem),
        }).catch(() => {/* non-critical */});
      }

      const pdf = await createAuthenticatedApiClient().post<{ downloadUrl: string }>(`/billing/invoices/${invoice.id}/pdf`, {});
      setPdfUrl(pdf.downloadUrl);
      setLastInvoiceId(invoice.id);
      notify("Invoice confirmed.");
      reset();
      setCouponDiscount(0); setAppliedCoupon(""); setCouponInput(""); setLoyaltyRedeem(0); setNotes("");
      setSplitEntries([{ mode: "CASH", amount: 0 }]);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Unable to create invoice.", "red");
    }
  }

  async function shareWhatsApp() {
    if (!customerId) return;
    try {
      if (lastInvoiceId) {
        await createAuthenticatedApiClient().post(`/billing/invoices/${lastInvoiceId}/share`, { channel: "whatsapp" });
      } else if (pdfUrl) {
        await createAuthenticatedApiClient().post("/billing/invoices/share-whatsapp", {
          customerId,
          pdfUrl,
        });
      }
      notify("Invoice sent via WhatsApp.");
    } catch {
      notify("WhatsApp share failed.", "red");
    }
  }

  async function printThermalInvoice() {
    if (!lastInvoiceId) return;
    try {
      const result = await createAuthenticatedApiClient().post<{ status: string; message: string }>(`/billing/invoices/${lastInvoiceId}/print`, {});
      notify(result.message || `Printer status: ${result.status}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Thermal print failed.", "red");
    }
  }

  function splitTotal(): number {
    return splitEntries.reduce((s, e) => s + e.amount, 0);
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="rounded-md border border-border bg-white">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Receipt className="size-4 text-emerald-700" aria-hidden="true" />
            POS invoice
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border border-border px-2 py-1 text-xs ${online ? "text-emerald-700" : "text-red-600"}`}>
              {online ? "Online" : "Offline"}
            </span>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void syncNow()}>
              <RefreshCcw className="size-4" aria-hidden="true" />Sync
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => setShowHeld((v) => !v)}>
              <BookMarked className="size-4" aria-hidden="true" />Held ({heldBills.length})
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-amber-700"
              onClick={() => holdBill(customerId)} disabled={lines.every((l) => !l.productId)}>
              <Pause className="size-4" aria-hidden="true" />Hold
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white" onClick={addLine}>
              <Plus className="size-4" aria-hidden="true" />Line
            </button>
          </div>
        </div>

        {/* Held bills panel */}
        {showHeld && heldBills.length > 0 && (
          <div className="border-b border-border bg-amber-50 p-3">
            <div className="mb-2 text-xs font-semibold text-amber-800">Held bills</div>
            <div className="flex flex-wrap gap-2">
              {heldBills.map((b) => (
                <div key={b.id} className="flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1">
                  <span className="text-xs text-slate-700">{b.label} ({b.lines.length} items)</span>
                  <button className="text-xs text-emerald-700 font-medium ml-1" onClick={() => { restoreHeld(b.id); setShowHeld(false); }}>Restore</button>
                  <button className="text-xs text-red-600 ml-1" onClick={() => deleteHeld(b.id)}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer + barcode */}
        <div className="grid gap-3 border-b border-border p-3 md:grid-cols-3">
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search customer" className="h-10 rounded-md border border-border px-3 text-sm" />
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-10 rounded-md border border-border px-3 text-sm">
            <option value="">Walk-in customer</option>
            {(customersQuery.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} | {c.phone}</option>
            ))}
          </select>
          <input value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} onKeyDown={handleBarcodeKey}
            placeholder="Scan barcode / SKU + Enter" className="h-10 rounded-md border border-border px-3 text-sm font-mono" />
        </div>
        {selectedCustomer && (selectedCustomer.outstandingDue ?? 0) > 0 && (
          <div className="border-b border-border bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Outstanding due: INR {(selectedCustomer.outstandingDue ?? 0).toFixed(2)}
            {selectedCustomer.creditLimit ? ` | Credit limit: INR ${selectedCustomer.creditLimit.toFixed(2)}` : ""}
          </div>
        )}

        {/* Line items */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Rate</th>
                <th className="px-3 py-3 font-medium">Discount</th>
                <th className="px-3 py-3 font-medium">GST%</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const taxable = Math.max(line.quantity * line.sellingPrice - line.discount, 0);
                const lineGst = taxable * (line.gstRate / 100);
                const lineTotal = taxable + lineGst;
                return (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <select
                        className="h-9 w-52 rounded-md border border-border px-2 text-sm"
                        value={line.productId}
                        onChange={(e) => {
                          const product = products.find((p) => p.id === e.target.value);
                          setLine(line.id, {
                            productId: e.target.value,
                            productName: product?.name ?? "",
                            sellingPrice: product ? decimalToNumber(product.sellingPrice) : 0,
                            gstRate: product ? decimalToNumber(product.gstRate) : 0,
                          });
                        }}
                      >
                        <option value="">{productsQuery.isLoading ? "Loading…" : "Select product"}</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input className="h-9 w-20 rounded-md border border-border px-2" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(e) => setLine(line.id, { quantity: Number(e.target.value) })} /></td>
                    <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.sellingPrice} onChange={(e) => setLine(line.id, { sellingPrice: Number(e.target.value) })} /></td>
                    <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.discount} onChange={(e) => setLine(line.id, { discount: Number(e.target.value) })} /></td>
                    <td className="px-3 py-2 text-slate-500">{line.gstRate}%</td>
                    <td className="px-3 py-2 text-right font-semibold">INR {lineTotal.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="inline-flex size-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" onClick={() => removeLine(line.id)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Notes */}
        <div className="border-t border-border p-3">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Invoice notes (optional)" className="h-9 w-full rounded-md border border-border px-3 text-sm" />
        </div>
      </div>

      {/* Bill summary */}
      <aside className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-950">Bill summary</div>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>INR {totals.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Discount</span><span>-INR {totals.discount.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">CGST</span><span>INR {totals.cgst.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">SGST</span><span>INR {totals.sgst.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold"><span>Grand Total</span><span>INR {totals.grandTotal.toFixed(2)}</span></div>
        </div>

        {/* Coupon */}
        <div className="mt-4 flex gap-2">
          <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Coupon code" className="h-9 flex-1 rounded-md border border-border px-3 text-sm" />
          <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={() => void applyCoupon()}>Apply</button>
        </div>
        {appliedCoupon && <div className="mt-1 text-xs text-emerald-700">✓ {appliedCoupon} applied (-INR {couponDiscount.toFixed(2)})</div>}

        {/* Loyalty */}
        {loyaltyBalance !== null && (
          <div className="mt-3 rounded-md border border-border p-2">
            <div className="text-xs text-slate-500 mb-1">Loyalty points: {loyaltyBalance} pts</div>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max={Math.min(loyaltyBalance, totals.grandTotal)} value={loyaltyRedeem}
                onChange={(e) => setLoyaltyRedeem(Math.min(Number(e.target.value), loyaltyBalance, totals.grandTotal))}
                className="h-8 w-24 rounded-md border border-border px-2 text-sm" />
              <span className="text-xs text-slate-500">pts to redeem (1 pt = INR 1)</span>
            </div>
          </div>
        )}

        {/* Split payment toggle */}
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
            <input type="checkbox" checked={useSplit} onChange={(e) => setUseSplit(e.target.checked)} className="size-4 accent-emerald-600" />
            Split payment
          </label>
        </div>
        {useSplit && (
          <div className="mt-2 space-y-2">
            {splitEntries.map((entry, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <select value={entry.mode} onChange={(e) => setSplitEntries((prev) => prev.map((en, i) => i === idx ? { ...en, mode: e.target.value as PaymentMode } : en))}
                  className="h-9 flex-1 rounded-md border border-border px-2 text-sm">
                  {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input type="number" min="0" value={entry.amount}
                  onChange={(e) => setSplitEntries((prev) => prev.map((en, i) => i === idx ? { ...en, amount: Number(e.target.value) } : en))}
                  className="h-9 w-28 rounded-md border border-border px-2 text-sm" placeholder="Amount" />
                {idx > 0 && <button className="text-red-500 text-sm" onClick={() => setSplitEntries((prev) => prev.filter((_, i) => i !== idx))}>✕</button>}
              </div>
            ))}
            <button className="text-sm text-emerald-700 font-medium" onClick={() => setSplitEntries((prev) => [...prev, { mode: "CASH", amount: 0 }])}>+ Add mode</button>
            {Math.abs(splitTotal() - totals.grandTotal) > 0.01 && (
              <div className="text-xs text-amber-600">Split total: INR {splitTotal().toFixed(2)} | Remaining: INR {(totals.grandTotal - splitTotal()).toFixed(2)}</div>
            )}
          </div>
        )}

        {/* Queue status */}
        <div className="mt-4 rounded-md border border-border bg-slate-50 p-2 text-xs text-slate-600">
          Pending {queueCounts.pending} | Syncing {queueCounts.syncing} | Failed {queueCounts.failed}
        </div>

        {status && (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${statusTone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{status}</div>
        )}

        {/* PDF + WhatsApp */}
        {pdfUrl && (
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-border text-sm font-medium text-slate-700" href={pdfUrl} target="_blank">
              <Printer className="size-4" aria-hidden="true" />PDF
            </a>
            {lastInvoiceId && (
              <button className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800" onClick={() => void printThermalInvoice()}>
                <Printer className="size-4" aria-hidden="true" />Thermal
              </button>
            )}
            {customerId && (
              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 text-sm font-medium text-green-800" onClick={() => void shareWhatsApp()}>
                <MessageCircle className="size-4" aria-hidden="true" />WA
              </button>
            )}
          </div>
        )}

        <button className="mt-4 h-11 w-full rounded-md bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => void confirmInvoice()} disabled={lines.every((l) => !l.productId)}>
          Confirm invoice
        </button>
      </aside>
    </section>
  );
}

function decimalToNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}
