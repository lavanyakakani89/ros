"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient, listAllProducts, type PaginatedResponse } from "@/lib/api-client";
import { appendDateRange, defaultFromDate, todayDate } from "@/lib/date-range";
import { formString } from "@/lib/form-values";
import { getStoredAuthSession } from "@/lib/vertical-config";

interface SupplierRecord {
  id: string;
  name: string;
}

interface PurchaseOrderRecord {
  id: string;
  poNumber: string;
  status: string;
  approvalStatus: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | string;
  rejectionReason?: string | null;
  totalAmount: string | number;
  createdAt: string;
  supplier: SupplierRecord;
  items: Array<{
    id: string;
    productName: string;
    quantity: string | number;
    receivedQuantity: string | number;
    unit: string;
    purchasePrice: string | number;
  }>;
}

export function PurchasesClient() {
  const queryClient = useQueryClient();
  const role = getStoredAuthSession()?.user?.role;
  const canApprove = role === "OWNER" || role === "MANAGER";
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(() => defaultFromDate(30));
  const [to, setTo] = useState(() => todayDate());
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const ordersQuery = useQuery({
    queryKey: ["purchase-orders", status, from, to, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (status) params.set("status", status);
      appendDateRange(params, from, to);
      return createAuthenticatedApiClient().get<PaginatedResponse<PurchaseOrderRecord>>(`/purchase-orders?${params.toString()}`);
    },
  });
  const suppliersQuery = useQuery({
    queryKey: ["suppliers-for-po"],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<SupplierRecord>>("/suppliers?limit=100"),
  });
  const productsQuery = useQuery({
    queryKey: ["products-for-po"],
    queryFn: () => listAllProducts(),
  });
  const createOrder = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/purchase-orders", payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
  const receiveOrder = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().post(`/purchase-orders/${id}/receive`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
    },
  });
  const approveOrder = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/purchase-orders/${id}/approve`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
  const rejectOrder = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => createAuthenticatedApiClient().post(`/purchase-orders/${id}/reject`, { reason }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
  const orders = ordersQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  const error = ordersQuery.error ?? suppliersQuery.error ?? productsQuery.error ?? createOrder.error ?? receiveOrder.error ?? approveOrder.error ?? rejectOrder.error;
  useEffect(() => {
    setPage(1);
  }, [status, from, to]);

  function handleCreate(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const product = products.find((candidate) => candidate.id === form.get("productId"));
    createOrder.mutate(
      {
        supplierId: formString(form, "supplierId"),
        items: [
          {
            productId: product?.id,
            productName: product?.name ?? formString(form, "productName"),
            quantity: Number(form.get("quantity")),
            unit: product?.unit ?? (formString(form, "unit") || "piece"),
            purchasePrice: Number(form.get("purchasePrice")),
          },
        ],
      },
      { onSuccess: () => formElement.reset() },
    );
  }

  function handleReject(order: PurchaseOrderRecord) {
    const reason = window.prompt(`Reason for rejecting ${order.poNumber}`);
    if (!reason?.trim()) {
      return;
    }

    rejectOrder.mutate({ id: order.id, reason: reason.trim() });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Create PO</div>
        {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
        <form className="space-y-3" onSubmit={handleCreate}>
          <label className="block text-sm font-medium text-slate-700">
            Supplier
            <select name="supplierId" className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" required>
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Product
            <select name="productId" className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              <option value="">Manual item</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <TextInput name="productName" label="Manual product name" />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput name="quantity" label="Qty" type="number" required />
            <TextInput name="unit" label="Unit" defaultValue="piece" />
            <TextInput name="purchasePrice" label="Price" type="number" required />
          </div>
          <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white" disabled={createOrder.isPending}>
            <Plus className="size-4" aria-hidden="true" />
            Create purchase order
          </button>
        </form>
      </section>
      <section className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="text-sm font-semibold text-slate-950">Orders</div>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm">
              <option value="">All</option>
              {["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>
        <div className="divide-y divide-border">
          {orders.length > 0 ? orders.map((order) => (
            <article key={order.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{order.poNumber}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{order.supplier.name}</span>
                    <span>|</span>
                    <span>{order.status}</span>
                    <span className={approvalBadgeClass(order.approvalStatus)}>{approvalLabel(order.approvalStatus)}</span>
                    <span>|</span>
                    <span>{money(Number(order.totalAmount))}</span>
                    {order.rejectionReason ? <span className="text-red-600">Reason: {order.rejectionReason}</span> : null}
                  </div>
                </div>
                {canApprove && order.approvalStatus === "PENDING_APPROVAL" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700"
                      disabled={approveOrder.isPending}
                      onClick={() => approveOrder.mutate(order.id)}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Approve
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700"
                      disabled={rejectOrder.isPending}
                      onClick={() => handleReject(order)}
                    >
                      <XCircle className="size-4" aria-hidden="true" />
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 space-y-2">
                {order.items.map((item) => (
                  <form key={item.id} className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-[1fr_100px_auto]" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    receiveOrder.mutate({ id: order.id, payload: { items: [{ itemId: item.id, receivedQuantity: Number(form.get("receivedQuantity")) }] } });
                  }}>
                    <div className="text-sm text-slate-700">{item.productName} | Ordered {Number(item.quantity)} | Received {Number(item.receivedQuantity)}</div>
                    <input name="receivedQuantity" type="number" step="0.001" max={Number(item.quantity) - Number(item.receivedQuantity)} className="h-9 rounded-md border border-border px-2 text-sm" required />
                    <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={receiveOrder.isPending || order.status === "RECEIVED" || order.approvalStatus !== "APPROVED"}>
                      <Save className="size-4" aria-hidden="true" />
                      {order.approvalStatus === "APPROVED" ? "Receive" : "Needs approval"}
                    </button>
                  </form>
                ))}
              </div>
            </article>
          )) : <div className="p-4 text-sm text-slate-500">No purchase orders yet.</div>}
        </div>
        <PaginationControls page={page} limit={pageSize} total={ordersQuery.data?.total ?? 0} onPageChange={setPage} />
      </section>
    </div>
  );
}

function TextInput({ name, label, type = "text", defaultValue, required }: Readonly<{ name: string; label: string; type?: string; defaultValue?: string; required?: boolean }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} required={required} step={type === "number" ? "0.01" : undefined} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600" />
    </label>
  );
}

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function approvalLabel(status: string): string {
  if (status === "PENDING_APPROVAL") return "Pending approval";
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Rejected";
  return status;
}

function approvalBadgeClass(status: string): string {
  if (status === "APPROVED") {
    return "rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700";
  }
  if (status === "REJECTED") {
    return "rounded bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700";
  }
  return "rounded bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700";
}
