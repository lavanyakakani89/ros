"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createAuthenticatedApiClient, listProducts, type ProductRecord } from "@/lib/api-client";
import { getStoredTenant } from "@/lib/vertical-config";

interface Quotation {
  id: string;
  quotationNumber: string;
  status: string;
  grandTotal: string | number;
  validUntil?: string | null;
  createdAt: string;
  customer?: { name: string } | null;
  items: Array<{ productName: string; quantity: number | string; sellingPrice: number | string; total: number | string }>;
}

interface CustomerResult {
  id: string;
  name: string;
  phone: string;
  address?: string | null;
  outstandingDue?: number | string | null;
}

interface QuoteLine {
  productId?: string;
  productName: string;
  quantity: number;
  unit: string;
  sellingPrice: number;
  discount: number;
  gstRate: number;
  stock?: number;
  reorderLevel?: number | null;
}

export function QuotationsClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const gstEnabled = getStoredTenant()?.gstEnabled ?? true;
  const [showForm, setShowForm] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerResult | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [billDiscount, setBillDiscount] = useState(0);
  const [lines, setLines] = useState<QuoteLine[]>([]);

  const quotationsQuery = useQuery({
    queryKey: ["quotations"],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Quotation[] }>("/quotations"),
  });
  const productsQuery = useQuery({ queryKey: ["products", "quotation-search"], queryFn: () => listProducts() });
  const customersQuery = useQuery({
    queryKey: ["customers", "quotations", customerSearch],
    enabled: customerSearch.trim().length >= 2,
    queryFn: () => createAuthenticatedApiClient().get<{ data: CustomerResult[] }>(`/customers?limit=20&search=${encodeURIComponent(customerSearch)}`),
  });
  const createCustomer = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post<CustomerResult>("/customers", payload),
    onSuccess: async (customer) => {
      setSelectedCustomer(customer);
      setCustomerSearch(`${customer.name} ${customer.phone}`);
      setShowNewCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      await queryClient.invalidateQueries({ queryKey: ["customers", "quotations"] });
    },
  });
  const createQuotation = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/quotations", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["quotations"] });
      resetForm();
      setShowForm(false);
    },
  });
  const convertToInvoice = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post<{ suggestedPayload: object }>(`/quotations/${id}/convert`, {}),
    onSuccess: () => router.push("/billing"),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => createAuthenticatedApiClient().put(`/quotations/${id}/status`, { status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["quotations"] }),
  });

  const quotations = quotationsQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  const productResults = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) =>
        [product.name, product.sku, product.barcode]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)),
      )
      .slice(0, 8);
  }, [productSearch, products]);
  const totals = useMemo(() => calculateTotals(lines, billDiscount, gstEnabled), [billDiscount, gstEnabled, lines]);
  const error = createQuotation.error ?? createCustomer.error ?? quotationsQuery.error;

  function handleProductKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setProductSearch("");
      searchRef.current?.focus();
      return;
    }
    if (event.key !== "Enter" || !productSearch.trim()) return;
    event.preventDefault();
    const code = productSearch.trim();
    const exact = products.find((product) => product.barcode === code || product.sku === code);
    const product = exact ?? productResults[0];
    if (product) {
      addProduct(product);
    }
  }

  function addProduct(product: ProductRecord) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) => line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      }

      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unit: product.unit,
          sellingPrice: Number(product.sellingPrice),
          discount: 0,
          gstRate: gstEnabled ? Number(product.gstRate) : 0,
          stock: Number(product.currentStock),
          reorderLevel: product.reorderLevel === null || product.reorderLevel === undefined ? null : Number(product.reorderLevel),
        },
      ];
    });
    setProductSearch("");
    searchRef.current?.focus();
  }

  function handleCreateCustomer() {
    if (!newCustomerName.trim() || !newCustomerPhone.trim() || !newCustomerAddress.trim()) return;
    createCustomer.mutate({
      customerCode: `CUST-${newCustomerPhone.trim()}`,
      name: newCustomerName.trim(),
      phone: newCustomerPhone.trim(),
      address: newCustomerAddress.trim(),
    });
  }

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (lines.length === 0 || !validUntil) return;
    createQuotation.mutate({
      customerId: selectedCustomer?.id,
      validUntil,
      notes: notes || undefined,
      terms: terms || undefined,
      billDiscount,
      items: lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        unit: line.unit,
        sellingPrice: line.sellingPrice,
        discount: line.discount,
        gstRate: gstEnabled ? line.gstRate : 0,
      })),
    });
  }

  function resetForm() {
    setCustomerSearch("");
    setSelectedCustomer(null);
    setShowNewCustomer(false);
    setProductSearch("");
    setValidUntil(defaultValidUntil());
    setNotes("");
    setTerms("");
    setBillDiscount(0);
    setLines([]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-950">Quotations / Estimates</h1>
        <button onClick={() => setShowForm((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white">
          <Plus className="size-4" aria-hidden="true" />
          New quotation
        </button>
      </div>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}

      {showForm ? (
        <form onSubmit={handleSubmit} className="grid gap-4 rounded-md border border-border bg-white p-4 xl:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <section>
                <label className="text-xs font-medium text-slate-500">Customer search</label>
                <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-border px-3">
                  <Search className="size-4 text-slate-400" aria-hidden="true" />
                  <input
                    value={customerSearch}
                    onChange={(event) => {
                      setCustomerSearch(event.target.value);
                      setSelectedCustomer(null);
                      setShowNewCustomer(false);
                    }}
                    placeholder="Name or phone"
                    className="min-w-0 flex-1 text-sm outline-none"
                  />
                </div>
                <div className="mt-2 grid gap-1">
                  {selectedCustomer ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                      {selectedCustomer.name} | {selectedCustomer.phone}
                      <button type="button" className="ml-2 font-semibold" onClick={() => setSelectedCustomer(null)}>Clear</button>
                    </div>
                  ) : null}
                  {!selectedCustomer && customerSearch.trim().length >= 2 ? (customersQuery.data?.data ?? []).slice(0, 4).map((customer) => (
                    <button type="button" key={customer.id} className="rounded-md border border-slate-200 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={() => setSelectedCustomer(customer)}>
                      {customer.name} | {customer.phone}
                    </button>
                  )) : null}
                  {customerSearch.trim().length >= 2 && !selectedCustomer && !showNewCustomer ? (
                    <button type="button" className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-left text-xs font-semibold text-emerald-800" onClick={() => {
                      setShowNewCustomer(true);
                      setNewCustomerName(customerSearch.replace(/\d/g, "").trim());
                      setNewCustomerPhone(customerSearch.replace(/\D/g, "").slice(0, 15));
                    }}>
                      <UserPlus className="size-3.5" aria-hidden="true" />
                      New customer
                    </button>
                  ) : null}
                </div>
                {selectedCustomer && Number(selectedCustomer.outstandingDue ?? 0) > 0 ? (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Outstanding due ₹{Number(selectedCustomer.outstandingDue).toFixed(2)}
                  </div>
                ) : null}
                {showNewCustomer ? (
                  <div className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      Add customer
                      <button type="button" className="text-slate-500" onClick={() => setShowNewCustomer(false)}>
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Customer name" className="h-9 rounded-md border border-border px-3 text-sm" />
                    <input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} placeholder="Phone number" className="h-9 rounded-md border border-border px-3 text-sm" />
                    <input value={newCustomerAddress} onChange={(event) => setNewCustomerAddress(event.target.value)} placeholder="Address" className="h-9 rounded-md border border-border px-3 text-sm" />
                    <button type="button" className="h-9 rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800" onClick={handleCreateCustomer} disabled={createCustomer.isPending}>Save customer</button>
                  </div>
                ) : null}
              </section>

              <section>
                <label className="text-xs font-medium text-slate-500">Validity date</label>
                <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" required />
                <label className="mt-3 block text-xs font-medium text-slate-500">Product search / barcode</label>
                <input ref={searchRef} value={productSearch} onChange={(event) => setProductSearch(event.target.value)} onKeyDown={handleProductKey} placeholder="Scan barcode, SKU, or type product name + Enter" className="mt-1 h-10 w-full rounded-md border border-border px-3 font-mono text-sm" />
                {productSearch.trim() ? (
                  <div className="mt-2 grid gap-1">
                    {productResults.length > 0 ? productResults.map((product) => (
                      <button type="button" key={product.id} className="rounded-md border border-slate-200 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50" onClick={() => addProduct(product)}>
                        <span className="font-medium">{product.name}</span>
                        <span className="ml-2 text-slate-400">{product.sku || product.barcode || product.unit}</span>
                        <span className="ml-2 text-slate-500">₹{Number(product.sellingPrice).toFixed(2)}</span>
                        <StockBadge stock={Number(product.currentStock)} reorderLevel={product.reorderLevel === null || product.reorderLevel === undefined ? null : Number(product.reorderLevel)} />
                        {gstEnabled ? <span className="ml-2 text-slate-400">GST {Number(product.gstRate)}%</span> : null}
                      </button>
                    )) : <div className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700">No product found</div>}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Qty</th>
                    <th className="px-3 py-2 font-medium">Rate</th>
                    <th className="px-3 py-2 font-medium">Disc %</th>
                    {gstEnabled ? <th className="px-3 py-2 font-medium">GST%</th> : null}
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={gstEnabled ? 7 : 6} className="px-3 py-8 text-center text-sm text-slate-500">Search or scan products to build the quotation.</td>
                    </tr>
                  ) : null}
                  {lines.map((line, index) => (
                    <tr key={`${line.productId ?? line.productName}-${String(index)}`} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{line.productName}</div>
                        <div className="text-xs text-slate-500">{line.unit} <StockBadge stock={line.stock} reorderLevel={line.reorderLevel} /></div>
                      </td>
                      <td className="px-3 py-2"><input className="h-9 w-20 rounded-md border border-border px-2" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /></td>
                      <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.sellingPrice} onChange={(event) => updateLine(index, { sellingPrice: Number(event.target.value) })} /></td>
                      <td className="px-3 py-2"><input className="h-9 w-20 rounded-md border border-border px-2" type="number" min="0" max="100" value={line.discount} onChange={(event) => updateLine(index, { discount: Math.min(Math.max(Number(event.target.value), 0), 100) })} /></td>
                      {gstEnabled ? <td className="px-3 py-2 text-slate-500">{line.gstRate}%</td> : null}
                      <td className="px-3 py-2 text-right font-semibold">₹{lineTotal(line, gstEnabled).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" className="inline-flex size-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm" />
            <textarea value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Terms and conditions" className="min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm" />
          </div>

          <aside className="rounded-md border border-border bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-950">Quotation summary</div>
            <div className="mt-4 grid gap-2 text-sm">
              <SummaryRow label="Subtotal" value={totals.subtotal} />
              <SummaryRow label="Line discount" value={-totals.lineDiscount} />
              <SummaryRow label="Bill discount" value={-totals.billDiscount} />
              {gstEnabled ? <SummaryRow label="CGST" value={totals.cgst} /> : null}
              {gstEnabled ? <SummaryRow label="SGST" value={totals.sgst} /> : null}
              <div className="flex justify-between border-t border-border pt-3 text-base font-bold"><span>Grand total</span><span>₹{totals.grandTotal.toFixed(2)}</span></div>
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Bill discount (₹)
              <input type="number" min="0" value={billDiscount} onChange={(event) => setBillDiscount(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
            <button type="submit" disabled={createQuotation.isPending || lines.length === 0} className="mt-4 h-10 w-full rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
              {createQuotation.isPending ? "Creating..." : "Create quotation"}
            </button>
          </aside>
        </form>
      ) : null}

      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Quotations</div>
        {quotations.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No quotations yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Number</th>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Valid until</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quotations.map((quotation) => (
                  <tr key={quotation.id}>
                    <td className="px-4 py-2 font-mono text-xs">{quotation.quotationNumber}</td>
                    <td className="px-4 py-2">{quotation.customer?.name ?? "Walk-in"}</td>
                    <td className="px-4 py-2 text-right font-medium">₹{Number(quotation.grandTotal).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <select value={quotation.status} onChange={(event) => updateStatus.mutate({ id: quotation.id, status: event.target.value })}
                        className="h-7 rounded-md border border-border px-2 text-xs">
                        {["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CONVERTED", "EXPIRED"].map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString("en-IN") : "-"}</td>
                    <td className="px-4 py-2 text-right">
                      {quotation.status !== "CONVERTED" ? (
                        <button onClick={() => convertToInvoice.mutate(quotation.id)} className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Convert <ArrowRight className="size-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    setLines((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, ...patch } : line));
  }
}

function calculateTotals(lines: QuoteLine[], billDiscount: number, gstEnabled: boolean) {
  const lineBases = lines.map((line) => {
    const gross = line.quantity * line.sellingPrice;
    const lineDiscount = Math.min(gross, roundMoney(gross * (line.discount / 100)));
    return {
      gross,
      lineDiscount,
      taxable: Math.max(gross - lineDiscount, 0),
      gstRate: line.gstRate,
    };
  });
  const subtotal = lineBases.reduce((sum, line) => sum + line.gross, 0);
  const lineDiscount = lineBases.reduce((sum, line) => sum + line.lineDiscount, 0);
  const totalTaxable = lineBases.reduce((sum, line) => sum + line.taxable, 0);
  const cappedBillDiscount = Math.min(Math.max(billDiscount, 0), totalTaxable);
  const taxTotals = lineBases.reduce(
    (accumulator, line) => {
      const share = totalTaxable > 0 ? roundMoney(cappedBillDiscount * (line.taxable / totalTaxable)) : 0;
      const taxable = Math.max(line.taxable - share, 0);
      const gst = gstEnabled ? taxable * (line.gstRate / 100) : 0;
      return {
        cgst: roundMoney(accumulator.cgst + gst / 2),
        sgst: roundMoney(accumulator.sgst + gst / 2),
        grandTotal: roundMoney(accumulator.grandTotal + taxable + gst),
      };
    },
    { cgst: 0, sgst: 0, grandTotal: 0 },
  );

  return {
    subtotal: roundMoney(subtotal),
    lineDiscount: roundMoney(lineDiscount),
    billDiscount: cappedBillDiscount,
    cgst: taxTotals.cgst,
    sgst: taxTotals.sgst,
    grandTotal: taxTotals.grandTotal,
  };
}

function lineTotal(line: QuoteLine, gstEnabled: boolean): number {
  const gross = line.quantity * line.sellingPrice;
  const discount = Math.min(gross, gross * (line.discount / 100));
  const taxable = Math.max(gross - discount, 0);
  const gst = gstEnabled ? taxable * (line.gstRate / 100) : 0;
  return roundMoney(taxable + gst);
}

function StockBadge({ stock, reorderLevel }: Readonly<{ stock: number | undefined; reorderLevel: number | null | undefined }>) {
  if (stock === undefined) return null;
  const out = stock <= 0;
  const low = !out && reorderLevel !== null && reorderLevel !== undefined && stock <= reorderLevel;
  const className = out ? "bg-red-50 text-red-700" : low ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700";
  const label = out ? "Out" : low ? "Low" : "In stock";
  return <span className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-[11px] ${className}`}>{label}</span>;
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: number }>) {
  const prefix = value < 0 ? "-₹" : "₹";
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span>{prefix}{Math.abs(value).toFixed(2)}</span>
    </div>
  );
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultValidUntil(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}
