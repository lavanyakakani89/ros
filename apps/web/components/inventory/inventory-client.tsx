"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { ProductFieldForm } from "@/components/inventory/product-field-form";
import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient, listProducts, type ProductRecord } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredVerticalConfig } from "@/lib/vertical-config";

interface ProductBatch {
  id: string;
  batchNumber: string;
  expiryDate?: string | null;
  quantity: string | number;
  purchasePrice: string | number;
}

export function InventoryClient() {
  const queryClient = useQueryClient();
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const productsQuery = useQuery({
    queryKey: ["products", lowStockOnly],
    queryFn: () => listProducts({ lowStock: lowStockOnly }),
  });
  const expiringQuery = useQuery({
    queryKey: ["expiring-products"],
    queryFn: () => createAuthenticatedApiClient().get<unknown[]>("/inventory/products/expiring?days=30"),
    retry: false,
  });
  const products = productsQuery.data?.data ?? [];
  const lowStockCount = products.filter((product) => product.reorderLevel !== undefined && product.reorderLevel !== null && Number(product.currentStock) <= Number(product.reorderLevel)).length;
  const stockValue = products.reduce((sum, product) => sum + Number(product.currentStock) * Number(product.purchasePrice ?? product.sellingPrice), 0);

  return (
    <>
      <StatStrip
        items={[
          { label: "Active products", value: String(productsQuery.data?.total ?? products.length), tone: "blue" },
          { label: "Low stock", value: String(lowStockCount), tone: "amber" },
          { label: "Expiring soon", value: String(expiringQuery.data?.length ?? 0), tone: "emerald" },
          { label: "Stock value", value: `₹${stockValue.toFixed(2)}`, tone: "slate" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-4">
          <ProductFieldForm onCreated={() => void productsQuery.refetch()} />
          <StockAdjustment products={products} onSaved={() => void queryClient.invalidateQueries({ queryKey: ["products"] })} />
        </div>
        <section className="rounded-md border border-border bg-white">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="text-sm font-semibold text-slate-950">Products</div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} className="size-4 accent-emerald-600" />
              Low stock
            </label>
          </div>
          <ProductList products={products} loading={productsQuery.isLoading} error={productsQuery.error} />
        </section>
      </div>
    </>
  );
}

function ProductList({ products, loading, error }: Readonly<{ products: ProductRecord[]; loading: boolean; error: Error | null }>) {
  const queryClient = useQueryClient();
  const verticalConfig = getStoredVerticalConfig();
  const updateProduct = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/inventory/products/${id}`, payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
  const deleteProduct = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/inventory/products/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
  const addBatch = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().post(`/inventory/products/${id}/batches`, payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  if (loading) {
    return <div className="p-4 text-sm text-slate-500">Loading products</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-red-700">{error.message}</div>;
  }

  return (
    <div className="divide-y divide-border">
      {products.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">No products yet. Add your first item from the form.</div>
      ) : (
        products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            showBatchTools={(verticalConfig?.batchFields?.length ?? 0) > 0}
            onUpdate={(payload) => updateProduct.mutate({ id: product.id, payload })}
            onDelete={() => deleteProduct.mutate(product.id)}
            onBatch={(payload) => addBatch.mutate({ id: product.id, payload })}
          />
        ))
      )}
    </div>
  );
}

function ProductRow({ product, showBatchTools, onUpdate, onDelete, onBatch }: Readonly<{ product: ProductRecord; showBatchTools: boolean; onUpdate: (payload: object) => void; onDelete: () => void; onBatch: (payload: object) => void }>) {
  const [editing, setEditing] = useState(false);
  const [showBatches, setShowBatches] = useState(false);
  const batchesQuery = useQuery({
    queryKey: ["product-batches", product.id],
    queryFn: () => createAuthenticatedApiClient().get<ProductBatch[]>(`/inventory/products/${product.id}/batches`),
    enabled: showBatches,
    retry: false,
  });

  function handleEdit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onUpdate({
      name: formString(form, "name"),
      sku: formString(form, "sku") || undefined,
      barcode: formString(form, "barcode") || undefined,
      mrp: Number(form.get("mrp")),
      sellingPrice: Number(form.get("sellingPrice")),
      purchasePrice: Number(form.get("purchasePrice") || 0),
      gstRate: Number(form.get("gstRate")),
      reorderLevel: Number(form.get("reorderLevel") || 0),
    });
    setEditing(false);
  }

  function handleBatch(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onBatch({
      batchNumber: formString(form, "batchNumber"),
      expiryDate: formString(form, "expiryDate"),
      quantity: Number(form.get("quantity")),
      purchasePrice: Number(form.get("purchasePrice")),
    });
    setShowBatches(true);
  }

  if (editing) {
    return (
      <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={handleEdit}>
        <TextInput name="name" label="Name" defaultValue={product.name} required />
        <TextInput name="sku" label="SKU" defaultValue={product.sku ?? ""} />
        <TextInput name="barcode" label="Barcode" defaultValue={product.barcode ?? ""} />
        <TextInput name="mrp" label="MRP" type="number" defaultValue={String(product.mrp)} required />
        <TextInput name="sellingPrice" label="Selling price" type="number" defaultValue={String(product.sellingPrice)} required />
        <TextInput name="purchasePrice" label="Purchase price" type="number" defaultValue={String(product.purchasePrice ?? "")} />
        <TextInput name="gstRate" label="GST %" type="number" defaultValue={String(product.gstRate)} required />
        <TextInput name="reorderLevel" label="Reorder level" type="number" defaultValue={String(product.reorderLevel ?? "")} />
        <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2">Save changes</button>
      </form>
    );
  }

  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-950">{product.name}</div>
          <div className="text-xs text-slate-500">{product.unit} | GST {product.gstRate}%{product.sku ? ` | SKU ${product.sku}` : ""}</div>
          <div className="mt-1 text-xs text-slate-500">Stock {Number(product.currentStock)} | Reorder {product.reorderLevel ?? "not set"}</div>
        </div>
        <div className="flex gap-2">
          <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => setEditing(true)}>Edit</button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>
      {showBatchTools ? (
        <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3">
          <button className="text-sm font-medium text-emerald-700" onClick={() => setShowBatches((value) => !value)}>{showBatches ? "Hide batches" : "View batches"}</button>
          {showBatches ? (
            <div className="space-y-1 text-xs text-slate-600">
              {(batchesQuery.data ?? []).map((batch) => (
                <div key={batch.id}>{batch.batchNumber} | Qty {Number(batch.quantity)} | Exp {batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString("en-IN") : "NA"}</div>
              ))}
              {batchesQuery.data?.length === 0 ? <div>No batches yet</div> : null}
            </div>
          ) : null}
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={handleBatch}>
            <input name="batchNumber" placeholder="Batch" className="h-9 rounded-md border border-border px-2 text-sm" required />
            <input name="expiryDate" type="date" className="h-9 rounded-md border border-border px-2 text-sm" required />
            <input name="quantity" type="number" step="0.001" placeholder="Qty" className="h-9 rounded-md border border-border px-2 text-sm" required />
            <input name="purchasePrice" type="number" step="0.01" placeholder="Price" className="h-9 rounded-md border border-border px-2 text-sm" required />
            <button className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white sm:col-span-4">Add batch</button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function StockAdjustment({ products, onSaved }: Readonly<{ products: ProductRecord[]; onSaved: () => void }>) {
  const mutation = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/inventory/stock-adjustment", payload),
    onSuccess: onSaved,
  });

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      productId: formString(form, "productId"),
      quantityChange: Number(form.get("quantityChange")),
      reason: formString(form, "reason"),
      notes: formString(form, "notes") || undefined,
    });
  }

  return (
    <section className="rounded-md border border-border bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-950">Stock adjustment</div>
      {mutation.error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mutation.error.message}</div> : null}
      <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-slate-700">
          Product
          <select name="productId" className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" required>
            <option value="">Select product</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <TextInput name="quantityChange" label="Qty change" type="number" required />
        <TextInput name="reason" label="Reason" required />
        <TextInput name="notes" label="Notes" />
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2" disabled={mutation.isPending}>
          <Save className="size-4" aria-hidden="true" />
          Save adjustment
        </button>
      </form>
    </section>
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
