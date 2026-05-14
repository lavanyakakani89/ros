"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MessageCircle, PackagePlus, Search, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createAuthenticatedApiClient, listProducts, type ProductRecord } from "@/lib/api-client";

type WhatsappOrderStatus = "DRAFT_CREATED" | "NEEDS_REVIEW" | "CONFIRMED" | "DISMISSED" | "CANCELLED";

interface ParsedOrderItem {
  line: string;
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
}

interface UnmatchedOrderLine {
  line: string;
  reason: string;
}

interface WhatsappOrderSummary {
  itemCount: number;
  totalQuantity: number;
  grandTotal: number;
}

interface WhatsappOrder {
  id: string;
  phone: string;
  customerName: string | null;
  rawText: string;
  status: WhatsappOrderStatus;
  createdAt: string;
  updatedAt: string;
  parsedItems: ParsedOrderItem[];
  unmatchedLines: UnmatchedOrderLine[];
  summary: WhatsappOrderSummary;
  customer?: {
    id: string;
    name: string;
    phone: string;
    address?: string | null;
  } | null;
  invoice?: {
    id: string;
    invoiceNumber: string;
    status: string;
    grandTotal: string | number;
  } | null;
}

interface DraftOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
}

const statusOptions: Array<{ label: string; value: WhatsappOrderStatus | "" }> = [
  { label: "Open", value: "" },
  { label: "Needs review", value: "NEEDS_REVIEW" },
  { label: "Draft created", value: "DRAFT_CREATED" },
  { label: "Confirmed", value: "CONFIRMED" },
  { label: "Dismissed", value: "DISMISSED" },
];

export function WhatsappOrdersClient() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WhatsappOrderStatus | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<DraftOrderItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [message, setMessage] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["whatsapp-orders", status],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (status) {
        params.set("status", status);
      }

      return createAuthenticatedApiClient().get<WhatsappOrder[]>(`/whatsapp/orders?${params.toString()}`);
    },
  });
  const detailQuery = useQuery({
    queryKey: ["whatsapp-order", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => createAuthenticatedApiClient().get<WhatsappOrder>(`/whatsapp/orders/${selectedId ?? ""}`),
  });
  const productsQuery = useQuery({
    queryKey: ["whatsapp-order-products", productSearch.trim()],
    enabled: productSearch.trim().length >= 2,
    queryFn: () => listProducts({ search: productSearch.trim(), limit: 12 }),
  });
  const saveItems = useMutation({
    mutationFn: () =>
      createAuthenticatedApiClient().put<WhatsappOrder>(`/whatsapp/orders/${selectedId ?? ""}/items`, {
        items: draftItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
        })),
      }),
    onSuccess: async (order) => {
      setMessage("WhatsApp order items saved.");
      queryClient.setQueryData(["whatsapp-order", order.id], order);
      await invalidateOrders(order.id);
    },
  });
  const confirmOrder = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<WhatsappOrder>(`/whatsapp/orders/${selectedId ?? ""}/confirm`, {}),
    onSuccess: async (order) => {
      setMessage(`Order confirmed as invoice ${order.invoice?.invoiceNumber ?? "draft"}.`);
      queryClient.setQueryData(["whatsapp-order", order.id], order);
      await invalidateOrders(order.id);
    },
  });
  const dismissOrder = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<WhatsappOrder>(`/whatsapp/orders/${selectedId ?? ""}/dismiss`, {}),
    onSuccess: async (order) => {
      setMessage("WhatsApp order dismissed.");
      queryClient.setQueryData(["whatsapp-order", order.id], order);
      await invalidateOrders(order.id);
    },
  });

  const orders = ordersQuery.data ?? [];
  const selectedOrder = detailQuery.data ?? orders.find((order) => order.id === selectedId) ?? null;
  const products = productsQuery.data?.data ?? [];
  const draftSummary = useMemo(() => ({
    itemCount: draftItems.length,
    totalQuantity: roundQuantity(draftItems.reduce((sum, item) => sum + item.quantity, 0)),
    grandTotal: roundMoney(draftItems.reduce((sum, item) => sum + item.quantity * item.sellingPrice, 0)),
  }), [draftItems]);
  const busy = saveItems.isPending || confirmOrder.isPending || dismissOrder.isPending;
  const error = ordersQuery.error ?? detailQuery.error ?? productsQuery.error ?? saveItems.error ?? confirmOrder.error ?? dismissOrder.error;

  useEffect(() => {
    if (!selectedId && orders[0]) {
      setSelectedId(orders[0].id);
    }
  }, [orders, selectedId]);

  useEffect(() => {
    if (!selectedOrder) {
      setDraftItems([]);
      return;
    }

    setDraftItems(selectedOrder.parsedItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: Number(item.quantity),
      sellingPrice: Number(item.sellingPrice),
    })));
  }, [selectedOrder?.id, selectedOrder?.updatedAt]);

  async function invalidateOrders(orderId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["whatsapp-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["whatsapp-order", orderId] }),
    ]);
  }

  function addProduct(product: ProductRecord) {
    setDraftItems((current) => {
      const existingIndex = current.findIndex((item) => item.productId === product.id);
      if (existingIndex >= 0) {
        return current.map((item, index) => index === existingIndex ? { ...item, quantity: roundQuantity(item.quantity + 1) } : item);
      }

      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          sellingPrice: Number(product.sellingPrice),
        },
      ];
    });
    setProductSearch("");
  }

  function updateDraftItem(index: number, patch: Partial<Pick<DraftOrderItem, "quantity" | "sellingPrice">>) {
    setDraftItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function removeDraftItem(index: number) {
    setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Inbound orders</h2>
              <p className="text-xs text-slate-500">Review pasted and Cloud API WhatsApp orders.</p>
            </div>
            <MessageCircle className="size-5 text-emerald-600" aria-hidden="true" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {statusOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`h-9 rounded-md border px-3 text-xs font-semibold ${status === option.value ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border text-slate-600 hover:bg-slate-50"}`}
                onClick={() => {
                  setStatus(option.value);
                  setSelectedId(null);
                  setMessage("");
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {ordersQuery.isLoading ? <OrderListSkeleton /> : null}
          {!ordersQuery.isLoading && orders.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No WhatsApp orders in this filter.</div>
          ) : null}
          {orders.map((order) => (
            <button
              key={order.id}
              type="button"
              className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-slate-50 ${selectedId === order.id ? "bg-emerald-50" : "bg-white"}`}
              onClick={() => {
                setSelectedId(order.id);
                setMessage("");
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-950">{order.customerName ?? order.phone}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(order.createdAt)} | {order.summary.itemCount} items | ₹{money(order.summary.grandTotal)}</div>
                </div>
                <StatusBadge status={order.status} />
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{order.rawText}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="min-h-[540px] rounded-md border border-border bg-white">
        {!selectedOrder ? (
          <div className="flex min-h-[420px] items-center justify-center px-4 text-sm text-slate-500">
            Select an inbound order to review.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-950">{selectedOrder.customer?.name ?? selectedOrder.customerName ?? "WhatsApp customer"}</h2>
                    <StatusBadge status={selectedOrder.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{selectedOrder.customer?.phone ?? selectedOrder.phone} | {formatDateTime(selectedOrder.createdAt)}</p>
                  {selectedOrder.invoice ? (
                    <p className="mt-1 text-xs font-medium text-emerald-700">Linked invoice: {selectedOrder.invoice.invoiceNumber} ({selectedOrder.invoice.status})</p>
                  ) : null}
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
                  <div>{draftSummary.itemCount} items | Qty {draftSummary.totalQuantity}</div>
                  <div className="mt-1 text-base font-bold text-slate-950">₹{money(draftSummary.grandTotal)}</div>
                </div>
              </div>
              {message ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
              {error ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div> : null}
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Parsed line items</div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="min-w-[680px] w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Product</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Price</th>
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">No matched products yet.</td>
                          </tr>
                        ) : null}
                        {draftItems.map((item, index) => (
                          <tr key={`${item.productId}-${index}`} className="border-t border-border">
                            <td className="px-3 py-2 font-medium text-slate-900">{item.productName}</td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                value={item.quantity}
                                className="h-9 w-24 rounded-md border border-border px-2 text-sm"
                                onChange={(event) => updateDraftItem(index, { quantity: positiveNumber(event.target.value, item.quantity) })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.sellingPrice}
                                className="h-9 w-28 rounded-md border border-border px-2 text-sm"
                                onChange={(event) => updateDraftItem(index, { sellingPrice: nonNegativeNumber(event.target.value, item.sellingPrice) })}
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">₹{money(item.quantity * item.sellingPrice)}</td>
                            <td className="px-3 py-2 text-right">
                              <button type="button" className="inline-flex size-9 items-center justify-center rounded-md border border-red-200 text-red-600 hover:bg-red-50" onClick={() => removeDraftItem(index)} aria-label={`Remove ${item.productName}`}>
                                <Trash2 className="size-4" aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-md border border-border p-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Match product</label>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Search product name, barcode, or SKU"
                      className="h-10 w-full rounded-md border border-border px-9 text-sm outline-none focus:border-emerald-600"
                    />
                  </div>
                  {productsQuery.isFetching ? <div className="mt-2 text-xs text-slate-500">Searching products...</div> : null}
                  {productSearch.trim().length >= 2 && products.length === 0 && !productsQuery.isFetching ? (
                    <div className="mt-2 text-xs text-slate-500">No products found.</div>
                  ) : null}
                  {products.length > 0 ? (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
                      {products.map((product) => (
                        <button key={product.id} type="button" className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-emerald-50" onClick={() => addProduct(product)}>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">{product.name}</span>
                            <span className="block truncate text-xs text-slate-500">Barcode {product.barcode || "-"} | SKU {product.sku || "-"}</span>
                          </span>
                          <span className="shrink-0 font-semibold text-slate-900">₹{money(Number(product.sellingPrice))}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    onClick={() => saveItems.mutate()}
                    disabled={busy || draftItems.length === 0 || !isEditable(selectedOrder.status)}
                  >
                    {saveItems.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PackagePlus className="size-4" aria-hidden="true" />}
                    Save review
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    onClick={() => confirmOrder.mutate()}
                    disabled={busy || draftItems.length === 0 || !isEditable(selectedOrder.status)}
                  >
                    {confirmOrder.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                    Confirm order
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                    onClick={() => dismissOrder.mutate()}
                    disabled={busy || selectedOrder.status === "CONFIRMED" || selectedOrder.status === "DISMISSED"}
                  >
                    {dismissOrder.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
                    Dismiss
                  </button>
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Original message</div>
                  <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-700">{selectedOrder.rawText}</pre>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Unmatched lines</div>
                  {selectedOrder.unmatchedLines.length === 0 ? (
                    <p className="mt-2 text-sm text-amber-800">No unmatched lines.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {selectedOrder.unmatchedLines.map((line) => (
                        <div key={`${line.line}-${line.reason}`} className="rounded-md bg-white p-2 text-sm text-slate-700">
                          <div className="font-medium">{line.line}</div>
                          <div className="mt-1 text-xs text-slate-500">{line.reason}</div>
                          <button type="button" className="mt-2 h-8 rounded-md border border-amber-300 px-2 text-xs font-semibold text-amber-800 hover:bg-amber-100" onClick={() => setProductSearch(line.line)}>
                            Search this line
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function OrderListSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border p-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          <div className="mt-3 h-3 w-full animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: WhatsappOrderStatus }>) {
  const styles: Record<WhatsappOrderStatus, string> = {
    DRAFT_CREATED: "border-blue-200 bg-blue-50 text-blue-700",
    NEEDS_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
    CONFIRMED: "border-emerald-200 bg-emerald-50 text-emerald-700",
    DISMISSED: "border-slate-200 bg-slate-100 text-slate-600",
    CANCELLED: "border-red-200 bg-red-50 text-red-700",
  };

  return <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${styles[status]}`}>{status.replace("_", " ")}</span>;
}

function isEditable(status: WhatsappOrderStatus): boolean {
  return status === "DRAFT_CREATED" || status === "NEEDS_REVIEW";
}

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function money(value: number | string): string {
  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
