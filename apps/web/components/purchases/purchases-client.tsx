"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";
import { useState } from "react";

import { createAuthenticatedApiClient, listProducts, type PaginatedResponse } from "@/lib/api-client";
import { formString } from "@/lib/form-values";

interface SupplierRecord {
  id: string;
  name: string;
}

interface PurchaseOrderRecord {
  id: string;
  poNumber: string;
  status: string;
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
  const [status, setStatus] = useState("");
  const ordersQuery = useQuery({
    queryKey: ["purchase-orders", status],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<PurchaseOrderRecord>>(`/purchase-orders?limit=100${status ? `&status=${status}` : ""}`),
  });
  const suppliersQuery = useQuery({
    queryKey: ["suppliers-for-po"],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<SupplierRecord>>("/suppliers?limit=100"),
  });
  const productsQuery = useQuery({
    queryKey: ["products-for-po"],
    queryFn: () => listProducts(),
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
  const orders = ordersQuery.data?.data ?? [];
  const suppliers = suppliersQuery.data?.data ?? [];
  const products = productsQuery.data?.data ?? [];
  const error = ordersQuery.error ?? suppliersQuery.error ?? productsQuery.error ?? createOrder.error ?? receiveOrder.error;

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
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="text-sm font-semibold text-slate-950">Orders</div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-border px-2 text-sm">
            <option value="">All</option>
            {["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"].map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="divide-y divide-border">
          {orders.length > 0 ? orders.map((order) => (
            <article key={order.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{order.poNumber}</div>
                  <div className="text-xs text-slate-500">{order.supplier.name} | {order.status} | {money(Number(order.totalAmount))}</div>
                </div>
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
                    <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white" disabled={receiveOrder.isPending || order.status === "RECEIVED"}>
                      <Save className="size-4" aria-hidden="true" />
                      Receive
                    </button>
                  </form>
                ))}
              </div>
            </article>
          )) : <div className="p-4 text-sm text-slate-500">No purchase orders yet.</div>}
        </div>
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
