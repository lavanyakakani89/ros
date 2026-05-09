"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Save, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { ProductFieldForm } from "@/components/inventory/product-field-form";
import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient, downloadApiFile, listProducts, type ProductRecord } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredTenant, getStoredVerticalConfig } from "@/lib/vertical-config";

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
  const [importStatus, setImportStatus] = useState("");
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
  const importProducts = useMutation({
    mutationFn: (file: File) => createAuthenticatedApiClient().upload<ImportResult>("/inventory/products/import", file),
    onSuccess: async (result) => {
      setImportStatus(`Imported ${String(result.created)} new and ${String(result.updated)} updated. Failed ${String(result.failed)}.`);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
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
          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-950">Products</div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} className="size-4 accent-emerald-600" />
                Low stock
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void downloadApiFile("/inventory/products/template", "retailos-product-template.xls")}>
                <FileSpreadsheet className="size-4 text-emerald-700" aria-hidden="true" />
                Template
              </button>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void downloadApiFile("/inventory/products/export", "retailos-products-export.xls")}>
                <Download className="size-4 text-blue-700" aria-hidden="true" />
                Export
              </button>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
                <Upload className="size-4 text-amber-700" aria-hidden="true" />
                Import
                <input type="file" accept=".xls,.xlsx,.csv" className="hidden" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    importProducts.mutate(file);
                  }
                  event.currentTarget.value = "";
                }} />
              </label>
            </div>
            {importStatus ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{importStatus}</div> : null}
            {importProducts.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{importProducts.error.message}</div> : null}
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
  const gstEnabled = getStoredTenant()?.gstEnabled !== false;
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
      description: formString(form, "description") || undefined,
      partGroup: formString(form, "partGroup") || undefined,
      legacySubCategoryId: formString(form, "legacySubCategoryId") || undefined,
      unit: formString(form, "unit") || "piece",
      mrp: Number(form.get("mrp")),
      sellingPrice: Number(form.get("sellingPrice")),
      purchasePrice: formString(form, "purchasePrice") ? Number(form.get("purchasePrice")) : undefined,
      wholesalePrice: formString(form, "wholesalePrice") ? Number(form.get("wholesalePrice")) : undefined,
      defaultDiscountPercent: formString(form, "defaultDiscountPercent") ? Number(form.get("defaultDiscountPercent")) : undefined,
      gstRate: gstEnabled ? Number(form.get("gstRate")) : 0,
      cessRate: Number(form.get("cessRate") || 0),
      hsnCode: formString(form, "hsnCode") || undefined,
      reorderLevel: formString(form, "reorderLevel") ? Number(form.get("reorderLevel")) : undefined,
      purchaseUnit: formString(form, "purchaseUnit") || undefined,
      salesUnit: formString(form, "salesUnit") || undefined,
      alternateUnit: formString(form, "alternateUnit") || undefined,
      conversionValue: formString(form, "conversionValue") ? Number(form.get("conversionValue")) : undefined,
      godown: formString(form, "godown") || undefined,
      rack: formString(form, "rack") || undefined,
      defaultSaleQty: formString(form, "defaultSaleQty") ? Number(form.get("defaultSaleQty")) : undefined,
    });
    setEditing(false);
  }

  function handleBatch(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
      onBatch({
        batchNumber: formString(form, "batchNumber"),
        mfgDate: formString(form, "mfgDate") || undefined,
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
        <TextInput name="description" label="Description" defaultValue={product.description ?? ""} />
        <TextInput name="partGroup" label="Part / group" defaultValue={product.partGroup ?? ""} />
        <TextInput name="legacySubCategoryId" label="Category/Sub Category Code" defaultValue={product.legacySubCategoryId ?? ""} />
        <TextInput name="unit" label="Unit" defaultValue={product.unit} required />
        <TextInput name="mrp" label="MRP" type="number" defaultValue={String(product.mrp)} required />
        <TextInput name="sellingPrice" label="Selling price" type="number" defaultValue={String(product.sellingPrice)} required />
        <TextInput name="purchasePrice" label="Purchase price" type="number" defaultValue={String(product.purchasePrice ?? "")} />
        <TextInput name="wholesalePrice" label="Wholesale price" type="number" defaultValue={String(product.wholesalePrice ?? "")} />
        <TextInput name="defaultDiscountPercent" label="Discount %" type="number" defaultValue={String(product.defaultDiscountPercent ?? "")} />
        {gstEnabled ? <TextInput name="gstRate" label="GST %" type="number" defaultValue={String(product.gstRate)} required /> : null}
        <TextInput name="cessRate" label="CESS %" type="number" defaultValue={String(product.cessRate ?? 0)} />
        <TextInput name="hsnCode" label="HSN / SAC code" defaultValue={product.hsnCode ?? ""} />
        <TextInput name="reorderLevel" label="Reorder level" type="number" defaultValue={String(product.reorderLevel ?? "")} />
        <TextInput name="purchaseUnit" label="Purchase unit" defaultValue={product.purchaseUnit ?? ""} />
        <TextInput name="salesUnit" label="Sales unit" defaultValue={product.salesUnit ?? ""} />
        <TextInput name="alternateUnit" label="Alter unit" defaultValue={product.alternateUnit ?? ""} />
        <TextInput name="conversionValue" label="Conversion value" type="number" defaultValue={String(product.conversionValue ?? "")} />
        <TextInput name="godown" label="Godown" defaultValue={product.godown ?? ""} />
        <TextInput name="rack" label="Rack" defaultValue={product.rack ?? ""} />
        <TextInput name="defaultSaleQty" label="Default sale qty" type="number" defaultValue={String(product.defaultSaleQty ?? "")} />
        <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2">Save changes</button>
      </form>
    );
  }

  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-950">{product.name}</div>
          <div className="text-xs text-slate-500">{product.unit}{gstEnabled ? ` | GST ${String(product.gstRate)}%` : ""}{product.sku ? ` | SKU ${product.sku}` : ""}</div>
          <div className="mt-1 text-xs text-slate-500">Stock {Number(product.currentStock)} | Reorder {product.reorderLevel ?? "not set"}{product.rack ? ` | Rack ${product.rack}` : ""}</div>
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
            <input name="mfgDate" type="date" className="h-9 rounded-md border border-border px-2 text-sm" />
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

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
}
