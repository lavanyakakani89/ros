"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, MessageCircle, Pause, Printer, Receipt, RefreshCcw, Search, Trash2, Truck, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiUrl, createAuthenticatedApiClient, listProducts, refreshAuthSession } from "@/lib/api-client";
import type { ProductRecord } from "@/lib/api-client";
import { useBillingStore } from "@/lib/billing-store";
import { getPendingInvoiceCounts, queueInvoice, syncPendingInvoices } from "@/lib/offline-queue";
import { hasStoredAuthSession } from "@/lib/vertical-config";

const PAYMENT_SHORTCUTS = [
  { mode: "CASH", key: "F2", label: "Cash" },
  { mode: "UPI", key: "F4", label: "UPI" },
  { mode: "CARD", key: "F8", label: "Card" },
  { mode: "CREDIT", key: "F9", label: "Credit" },
] as const;
const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CREDIT", "NETBANKING"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

interface SplitEntry {
  mode: PaymentMode;
  amount: number;
}

interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  address?: string | null;
  creditLimit?: number | null;
  outstandingDue?: number | null;
}

interface LastBill {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  paymentMode: PaymentMode;
  pdfViewUrl: string;
}

export function PosInvoicePanel() {
  const queryClient = useQueryClient();
  const { lines, setLine, addLine, removeLine, reset, holdBill, restoreHeld, deleteHeld, heldBills } = useBillingStore();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [online, setOnline] = useState(true);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, syncing: 0, failed: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"green" | "red">("green");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [billDiscount, setBillDiscount] = useState(0);
  const [splitEntries, setSplitEntries] = useState<SplitEntry[]>([{ mode: "CASH", amount: 0 }]);
  const [useSplit, setUseSplit] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponInput, setCouponInput] = useState("");
  const [loyaltyRedeem, setLoyaltyRedeem] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [notes, setNotes] = useState("");
  const [deliveryRequired, setDeliveryRequired] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [lastBill, setLastBill] = useState<LastBill | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const productsQuery = useQuery({
    queryKey: ["products", "billing"],
    queryFn: () => listProducts(),
  });
  const customersQuery = useQuery({
    queryKey: ["customers", "billing", customerSearch],
    queryFn: () =>
      createAuthenticatedApiClient().get<{ data: CustomerRecord[] }>(
        `/customers?limit=20${customerSearch ? `&search=${encodeURIComponent(customerSearch)}` : ""}`,
      ),
  });
  const products = productsQuery.data?.data ?? [];
  const customerResults = customersQuery.data?.data ?? [];

  const totals = useMemo(() => {
    const itemTotals = lines.map((line) => {
      const gross = line.quantity * line.sellingPrice;
      const discountAmount = Math.min(gross, Math.round(gross * (line.discount / 100) * 100) / 100);
      const taxable = Math.max(gross - discountAmount, 0);
      const gst = taxable * (line.gstRate / 100);
      return {
        gross,
        discountAmount,
        cgst: Math.round((gst / 2) * 100) / 100,
        sgst: Math.round((gst / 2) * 100) / 100,
        total: Math.round((taxable + gst) * 100) / 100,
      };
    });
    const subtotal = itemTotals.reduce((sum, item) => sum + item.gross, 0);
    const lineDiscount = itemTotals.reduce((sum, item) => sum + item.discountAmount, 0);
    const billLevelDiscount = Math.max(billDiscount, 0) + couponDiscount + loyaltyRedeem;
    const cgst = itemTotals.reduce((sum, item) => sum + item.cgst, 0);
    const sgst = itemTotals.reduce((sum, item) => sum + item.sgst, 0);
    const preBillDiscountTotal = itemTotals.reduce((sum, item) => sum + item.total, 0);
    const grandTotal = Math.max(preBillDiscountTotal - billLevelDiscount, 0);
    return { subtotal, lineDiscount, billLevelDiscount, discount: lineDiscount + billLevelDiscount, cgst, sgst, grandTotal };
  }, [lines, billDiscount, couponDiscount, loyaltyRedeem]);

  useEffect(() => {
    barcodeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!selectedCustomer) {
      setLoyaltyBalance(null);
      setDeliveryRequired(false);
      setDeliveryAddress("");
      return;
    }

    setDeliveryAddress(selectedCustomer.address ?? "");
    createAuthenticatedApiClient()
      .get<{ points: number }>(`/loyalty/${selectedCustomer.id}`)
      .then((data) => setLoyaltyBalance(data.points))
      .catch(() => setLoyaltyBalance(null));
  }, [selectedCustomer]);

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

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const shortcut = PAYMENT_SHORTCUTS.find((item) => item.key === event.key);
      if (!shortcut) return;
      event.preventDefault();
      void confirmInvoice(shortcut.mode);
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  async function syncNow() {
    if (!hasStoredAuthSession()) {
      notify("Sign in before syncing.", "red");
      return;
    }

    await syncPendingInvoices(async () => {
      await refreshAuthSession();
      return createAuthenticatedApiClient();
    });
    setQueueCounts(await getPendingInvoiceCounts());
    notify("Offline queue synced.");
  }

  function notify(message: string, tone: "green" | "red" = "green") {
    setStatus(message);
    setStatusTone(tone);
  }

  function insertProduct(product: ProductRecord) {
    const existing = lines.find((line) => line.productId === product.id);
    if (existing) {
      setLine(existing.id, { quantity: existing.quantity + 1 });
    } else {
      const lineId = addLine();
      setLine(lineId, {
        productId: product.id,
        productName: product.name,
        sellingPrice: decimalToNumber(product.sellingPrice),
        gstRate: decimalToNumber(product.gstRate),
        quantity: 1,
        discount: 0,
      });
    }
    setLastBill(null);
    barcodeRef.current?.focus();
  }

  function handleBarcodeKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !barcodeInput.trim()) return;
    const code = barcodeInput.trim();
    const product = products.find((item) => item.barcode === code || item.sku === code);
    if (!product) {
      notify(`No product found for ${code}`, "red");
      setBarcodeInput("");
      return;
    }

    insertProduct(product);
    setBarcodeInput("");
  }

  function addSelectedProduct() {
    const product = products.find((item) => item.id === selectedProductId);
    if (!product) {
      notify("Select a product to add.", "red");
      return;
    }

    insertProduct(product);
    setSelectedProductId("");
  }

  async function createCustomerInline() {
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      notify("Customer name and phone are required.", "red");
      return;
    }

    try {
      const customer = await createAuthenticatedApiClient().post<CustomerRecord>("/customers", {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim(),
        ...(newCustomerAddress.trim() ? { address: newCustomerAddress.trim() } : {}),
      });
      setSelectedCustomer(customer);
      setCustomerSearch(`${customer.name} ${customer.phone}`);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      await queryClient.invalidateQueries({ queryKey: ["customers", "billing"] });
      notify("Customer added.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add customer.", "red");
    }
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
      notify(`Coupon applied: INR ${result.discount.toFixed(2)} off`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Invalid coupon", "red");
    }
  }

  async function confirmInvoice(paymentModeOverride?: PaymentMode) {
    const activeLines = lines.filter((line) => line.productId);
    if (activeLines.length === 0) {
      notify("Add at least one product.", "red");
      return;
    }

    const paymentMode = paymentModeOverride ?? (useSplit ? splitEntries[0]?.mode ?? "CASH" : "CASH");
    const customerId = selectedCustomer?.id;
    const deliveryPayload = deliveryRequired && selectedCustomer
      ? {
          customerId: selectedCustomer.id,
          deliveryAddress: deliveryAddress.trim() || selectedCustomer.address || "",
          ...(deliveryNotes.trim() ? { notes: deliveryNotes.trim() } : {}),
        }
      : undefined;

    if (deliveryRequired && (!customerId || !deliveryPayload?.deliveryAddress || deliveryPayload.deliveryAddress.length < 5)) {
      notify("Select a customer and enter a delivery address.", "red");
      return;
    }

    if (selectedCustomer) {
      const limit = selectedCustomer.creditLimit ?? 0;
      const outstanding = selectedCustomer.outstandingDue ?? 0;
      if (paymentMode === "CREDIT" && limit > 0 && outstanding + totals.grandTotal > limit) {
        notify(`Credit limit exceeded. Outstanding INR ${outstanding.toFixed(2)}, limit INR ${limit.toFixed(2)}`, "red");
        return;
      }
    }

    const billLevelDiscount = Math.min(totals.billLevelDiscount, totals.subtotal + totals.cgst + totals.sgst);
    const invoicePayload = {
      paymentMode,
      billDiscount: billLevelDiscount,
      ...(customerId ? { customerId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...((appliedCoupon || loyaltyRedeem > 0)
        ? { verticalData: { couponCode: appliedCoupon || undefined, couponDiscount, loyaltyRedeem } }
        : {}),
      items: activeLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        discountPercent: line.discount,
      })),
    };

    setIsSubmitting(true);
    setLastBill(null);

    try {
      if (!online || !hasStoredAuthSession()) {
        await queueInvoice(
          {
            invoice: invoicePayload,
            ...(deliveryPayload ? { delivery: deliveryPayload } : {}),
            autoPay: { mode: paymentMode },
          },
          "local-tenant",
        );
        setQueueCounts(await getPendingInvoiceCounts());
        notify(online ? "Invoice queued until sign in." : "Invoice queued offline.");
        clearBill();
        return;
      }

      const created = await createAuthenticatedApiClient().post<{ id: string; invoiceNumber: string; grandTotal: string | number }>("/billing/invoices", invoicePayload);
      const confirmed = await createAuthenticatedApiClient().post<{ id: string; invoiceNumber: string; grandTotal: string | number }>(`/billing/invoices/${created.id}/confirm`, {});

      if (useSplit) {
        for (const entry of splitEntries.filter((item) => item.amount > 0)) {
          await createAuthenticatedApiClient().post("/payments", {
            invoiceId: created.id,
            amount: entry.amount,
            mode: entry.mode,
          });
        }
      } else if (paymentMode !== "CREDIT") {
        await createAuthenticatedApiClient().post("/payments", {
          invoiceId: created.id,
          amount: Number(created.grandTotal),
          mode: paymentMode,
        });
      }

      if (loyaltyRedeem > 0 && customerId) {
        await createAuthenticatedApiClient().post("/loyalty/redeem", {
          customerId,
          invoiceId: created.id,
          points: Math.floor(loyaltyRedeem),
        }).catch(() => undefined);
      }

      if (deliveryPayload) {
        await createAuthenticatedApiClient().post("/delivery", {
          ...deliveryPayload,
          invoiceId: created.id,
        });
      }

      await createAuthenticatedApiClient().post(`/billing/invoices/${created.id}/pdf`, {});
      const pdfViewUrl = apiUrl(`/billing/invoices/${created.id}/pdf/view`);
      setLastBill({
        id: created.id,
        invoiceNumber: confirmed.invoiceNumber ?? created.invoiceNumber,
        grandTotal: Number(confirmed.grandTotal ?? created.grandTotal),
        paymentMode,
        pdfViewUrl,
      });
      notify("Invoice confirmed. Bill is ready to print.");
      clearBill();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to create invoice.", "red");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function shareWhatsApp() {
    if (!lastBill || !selectedCustomer) return;
    try {
      await createAuthenticatedApiClient().post(`/billing/invoices/${lastBill.id}/share`, { channel: "whatsapp" });
      notify("Invoice sent via WhatsApp.");
    } catch {
      notify("WhatsApp share failed.", "red");
    }
  }

  async function printThermalInvoice() {
    if (!lastBill) return;
    try {
      const result = await createAuthenticatedApiClient().post<{ status: string; message: string }>(`/billing/invoices/${lastBill.id}/print`, {});
      notify(result.message || `Printer status: ${result.status}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Thermal print failed.", "red");
    }
  }

  function clearBill() {
    reset();
    setBillDiscount(0);
    setCouponDiscount(0);
    setAppliedCoupon("");
    setCouponInput("");
    setLoyaltyRedeem(0);
    setNotes("");
    setDeliveryRequired(false);
    setDeliveryNotes("");
    setSplitEntries([{ mode: "CASH", amount: 0 }]);
    setUseSplit(false);
    barcodeRef.current?.focus();
  }

  function splitTotal(): number {
    return splitEntries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_390px]">
      <div className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Receipt className="size-4 text-emerald-700" aria-hidden="true" />
            POS invoice
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-1 text-xs ${online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
              {online ? "Online" : "Offline billing active"}
            </span>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void syncNow()}>
              <RefreshCcw className="size-4" aria-hidden="true" />
              Sync
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => setShowHeld((value) => !value)}>
              <BookMarked className="size-4" aria-hidden="true" />
              Held ({heldBills.length})
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-amber-700" onClick={() => holdBill(selectedCustomer?.id ?? "")} disabled={lines.length === 0}>
              <Pause className="size-4" aria-hidden="true" />
              Hold
            </button>
          </div>
        </div>

        {showHeld && heldBills.length > 0 ? (
          <div className="border-b border-border bg-amber-50 p-3">
            <div className="mb-2 text-xs font-semibold text-amber-800">Held bills</div>
            <div className="flex flex-wrap gap-2">
              {heldBills.map((bill) => (
                <div key={bill.id} className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2 py-1">
                  <span className="text-xs text-slate-700">{bill.label} ({bill.lines.length} items)</span>
                  <button className="text-xs font-medium text-emerald-700" onClick={() => { restoreHeld(bill.id); setShowHeld(false); }}>Restore</button>
                  <button className="text-xs text-red-600" onClick={() => deleteHeld(bill.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 border-b border-border p-3 lg:grid-cols-[1fr_1fr_1.1fr]">
          <div>
            <label className="text-xs font-medium text-slate-500">Customer search</label>
            <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-border px-3">
              <Search className="size-4 text-slate-400" aria-hidden="true" />
              <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Name or phone" className="min-w-0 flex-1 text-sm outline-none" />
            </div>
            <div className="mt-2 grid gap-1">
              {selectedCustomer ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                  Selected: {selectedCustomer.name} | {selectedCustomer.phone}
                  <button className="ml-2 font-semibold text-emerald-800" onClick={() => setSelectedCustomer(null)}>Clear</button>
                </div>
              ) : null}
              {customerSearch && !selectedCustomer
                ? customerResults.slice(0, 4).map((customer) => (
                    <button key={customer.id} className="rounded-md border border-slate-200 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={() => setSelectedCustomer(customer)}>
                      {customer.name} | {customer.phone}
                    </button>
                  ))
                : null}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Add customer here</label>
            <div className="mt-1 grid gap-2">
              <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Customer name" className="h-9 rounded-md border border-border px-3 text-sm" />
              <input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} placeholder="Phone number" className="h-9 rounded-md border border-border px-3 text-sm" />
              <input value={newCustomerAddress} onChange={(event) => setNewCustomerAddress(event.target.value)} placeholder="Address (optional)" className="h-9 rounded-md border border-border px-3 text-sm" />
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800" onClick={() => void createCustomerInline()}>
                <UserPlus className="size-4" aria-hidden="true" />
                Add customer
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Scan barcode</label>
            <input ref={barcodeRef} value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={handleBarcodeKey} placeholder="Scan barcode / SKU + Enter" className="mt-1 h-10 w-full rounded-md border border-border px-3 font-mono text-sm" />
            <div className="mt-2 flex gap-2">
              <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-border px-3 text-sm">
                <option value="">{productsQuery.isLoading ? "Loading products..." : "Select product"}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
              <button className="h-10 rounded-md bg-slate-900 px-3 text-sm font-medium text-white" onClick={addSelectedProduct}>Add item</button>
            </div>
          </div>
        </div>

        {selectedCustomer && (selectedCustomer.outstandingDue ?? 0) > 0 ? (
          <div className="border-b border-border bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Outstanding due: INR {(selectedCustomer.outstandingDue ?? 0).toFixed(2)}
            {selectedCustomer.creditLimit ? ` | Credit limit: INR ${selectedCustomer.creditLimit.toFixed(2)}` : ""}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Rate</th>
                <th className="px-3 py-3 font-medium">Discount %</th>
                <th className="px-3 py-3 font-medium">GST%</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">Scan a barcode or select a product to start billing.</td>
                </tr>
              ) : null}
              {lines.map((line) => {
                const gross = line.quantity * line.sellingPrice;
                const discountAmount = Math.min(gross, gross * (line.discount / 100));
                const taxable = Math.max(gross - discountAmount, 0);
                const lineGst = taxable * (line.gstRate / 100);
                const lineTotal = taxable + lineGst;
                return (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-slate-900">{line.productName}</td>
                    <td className="px-3 py-2"><input className="h-9 w-20 rounded-md border border-border px-2" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLine(line.id, { quantity: Number(event.target.value) })} /></td>
                    <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.sellingPrice} onChange={(event) => setLine(line.id, { sellingPrice: Number(event.target.value) })} /></td>
                    <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" max="100" value={line.discount} onChange={(event) => setLine(line.id, { discount: Math.min(Math.max(Number(event.target.value), 0), 100) })} /></td>
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

        <div className="grid gap-3 border-t border-border p-3 md:grid-cols-2">
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Invoice notes (optional)" className="h-9 rounded-md border border-border px-3 text-sm" />
          {selectedCustomer ? (
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={deliveryRequired} onChange={(event) => setDeliveryRequired(event.target.checked)} className="size-4 accent-emerald-600" />
              Delivery required
            </label>
          ) : null}
        </div>

        {selectedCustomer && deliveryRequired ? (
          <div className="grid gap-3 border-t border-border bg-slate-50 p-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Delivery address
              <input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Delivery notes
              <input value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
          </div>
        ) : null}
      </div>

      <aside className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-950">Bill summary</div>
        <div className="mt-4 grid gap-2 text-sm">
          <SummaryRow label="Subtotal" value={totals.subtotal} />
          <SummaryRow label="Line discount" value={-totals.lineDiscount} />
          <SummaryRow label="Bill discount" value={-totals.billLevelDiscount} />
          <SummaryRow label="CGST" value={totals.cgst} />
          <SummaryRow label="SGST" value={totals.sgst} />
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold"><span>Grand total</span><span>INR {totals.grandTotal.toFixed(2)}</span></div>
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Total bill discount (amount)
          <input type="number" min="0" value={billDiscount} onChange={(event) => setBillDiscount(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
        </label>

        <div className="mt-4 flex gap-2">
          <input value={couponInput} onChange={(event) => setCouponInput(event.target.value)} placeholder="Coupon code" className="h-9 flex-1 rounded-md border border-border px-3 text-sm" />
          <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={() => void applyCoupon()}>Apply</button>
        </div>
        {appliedCoupon ? <div className="mt-1 text-xs text-emerald-700">{appliedCoupon} applied (-INR {couponDiscount.toFixed(2)})</div> : null}

        {loyaltyBalance !== null ? (
          <div className="mt-3 rounded-md border border-border p-2">
            <div className="mb-1 text-xs text-slate-500">Loyalty points: {loyaltyBalance}</div>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max={Math.min(loyaltyBalance, totals.grandTotal)} value={loyaltyRedeem} onChange={(event) => setLoyaltyRedeem(Math.min(Number(event.target.value), loyaltyBalance, totals.grandTotal))} className="h-8 w-24 rounded-md border border-border px-2 text-sm" />
              <span className="text-xs text-slate-500">points to redeem</span>
            </div>
          </div>
        ) : null}

        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={useSplit} onChange={(event) => setUseSplit(event.target.checked)} className="size-4 accent-emerald-600" />
          Split payment
        </label>
        {useSplit ? (
          <div className="mt-2 grid gap-2">
            {splitEntries.map((entry, index) => (
              <div key={`${entry.mode}-${index}`} className="flex items-center gap-2">
                <select value={entry.mode} onChange={(event) => setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, mode: event.target.value as PaymentMode } : item))} className="h-9 flex-1 rounded-md border border-border px-2 text-sm">
                  {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
                <input type="number" min="0" value={entry.amount} onChange={(event) => setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(event.target.value) } : item))} className="h-9 w-28 rounded-md border border-border px-2 text-sm" />
                {index > 0 ? <button className="text-sm text-red-600" onClick={() => setSplitEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button> : null}
              </div>
            ))}
            <button className="text-left text-sm font-medium text-emerald-700" onClick={() => setSplitEntries((current) => [...current, { mode: "CASH", amount: 0 }])}>Add payment mode</button>
            {Math.abs(splitTotal() - totals.grandTotal) > 0.01 ? (
              <div className="text-xs text-amber-600">Split total INR {splitTotal().toFixed(2)} | Remaining INR {(totals.grandTotal - splitTotal()).toFixed(2)}</div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {PAYMENT_SHORTCUTS.map((shortcut) => (
            <button key={shortcut.mode} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm font-semibold text-emerald-900 disabled:opacity-50" onClick={() => void confirmInvoice(shortcut.mode)} disabled={isSubmitting || lines.length === 0}>
              <span className="block">{shortcut.label}</span>
              <span className="text-xs font-medium text-emerald-700">{shortcut.key}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-md border border-border bg-slate-50 p-2 text-xs text-slate-600">
          Offline queue: pending {queueCounts.pending} | syncing {queueCounts.syncing} | failed {queueCounts.failed}
        </div>

        {status ? (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${statusTone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{status}</div>
        ) : null}

        {lastBill ? (
          <section className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-semibold text-emerald-950">Bill ready</div>
            <div className="mt-1 text-xs text-emerald-800">{lastBill.invoiceNumber} | {lastBill.paymentMode} | INR {lastBill.grandTotal.toFixed(2)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-900" href={lastBill.pdfViewUrl} target="_blank">
                <Printer className="size-4" aria-hidden="true" />
                Open bill
              </a>
              <button className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-900" onClick={() => void printThermalInvoice()}>
                <Printer className="size-4" aria-hidden="true" />
                Thermal
              </button>
              {selectedCustomer ? (
                <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 text-sm font-medium text-green-800" onClick={() => void shareWhatsApp()}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  WA
                </button>
              ) : null}
            </div>
            <iframe className="mt-3 h-80 w-full rounded-md border border-emerald-200 bg-white" src={lastBill.pdfViewUrl} title="Invoice PDF" />
          </section>
        ) : null}

        {selectedCustomer && deliveryRequired ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
            <Truck className="size-4" aria-hidden="true" />
            Delivery will be created after invoice confirmation.
          </div>
        ) : null}
      </aside>
    </section>
  );
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: number }>) {
  const prefix = value < 0 ? "-INR " : "INR ";
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span>{prefix}{Math.abs(value).toFixed(2)}</span>
    </div>
  );
}

function decimalToNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}
