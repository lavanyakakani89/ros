"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CheckCircle2, Download, ExternalLink, FileSpreadsheet, History, Image as ImageIcon, Link2, Loader2, Plus, Save, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ProductFieldForm } from "@/components/inventory/product-field-form";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { StatStrip } from "@/components/shared/stat-strip";
import { apiUrl, createAuthenticatedApiClient, downloadApiFile, listProducts, type ProductRecord } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredAuthSession, getStoredTenant, getStoredVerticalConfig } from "@/lib/vertical-config";

interface ProductBatch {
  id: string;
  batchNumber: string;
  expiryDate?: string | null;
  quantity: string | number;
  purchasePrice: string | number;
}

interface StockMovement {
  date: string;
  type: "adjustment" | "sale" | "purchase" | "return";
  qty: number;
  reference: string;
  notes: string;
  runningBalance: number;
}

interface PaginatedMovements {
  data: StockMovement[];
  page: number;
  limit: number;
  total: number;
}

interface ProductImageSuggestion {
  id: string;
  title: string;
  sourceImageUrl: string;
  thumbnailUrl?: string | null;
  contextUrl?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  rights?: string | null;
  relevance: "VERY_RELEVANT" | "RELEVANT" | "LOW";
  score: number;
  status: "SUGGESTED" | "APPROVED" | "REJECTED";
  createdAt: string;
}

interface ProductImageSuggestionsResponse {
  configured: boolean;
  suggestions: ProductImageSuggestion[];
}

interface EcommerceFamilyCatalogResponse {
  families: EcommerceFamilyRecord[];
  suggestions: EcommerceFamilySuggestion[];
  ungroupedProducts: EcommerceFamilyProduct[];
}

interface EcommerceFamilyRecord {
  id: string;
  name: string;
  slug: string;
  attributeLabel: string;
  source: "MANUAL" | "SUGGESTED";
  isActive: boolean;
  items: EcommerceFamilyItem[];
}

interface EcommerceFamilyItem {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  mrp: number;
  sellingPrice: number;
  categoryName: string;
  brand: string | null;
  size: string | null;
  variantLabel: string;
  sortOrder: number;
  isDefault: boolean;
}

interface EcommerceFamilySuggestion {
  key: string;
  name: string;
  attributeLabel: "Size";
  items: Array<{
    productId: string;
    productName: string;
    variantLabel: string;
    sortOrder: number;
    sku: string | null;
    barcode: string | null;
    currentStock: number;
    categoryName: string;
    brand: string | null;
    imageUrl: string | null;
  }>;
}

interface EcommerceFamilyProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  mrp: number;
  sellingPrice: number;
  categoryName: string;
  brand: string | null;
  size: string | null;
  suggestedVariantLabel: string | null;
}

type InventoryView = "products" | "stock-count" | "expiry";

interface StockCountSummary {
  id: string;
  name: string;
  status: string;
  countedAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  _count: {
    items: number;
  };
}

interface StockCountDetail extends Omit<StockCountSummary, "_count"> {
  createdBy: string;
  approvedBy?: string | null;
  items: StockCountItem[];
}

interface StockCountItem {
  id: string;
  productId: string;
  productName: string;
  systemQty: number | string;
  countedQty: number | string | null;
  variance: number | string;
  product: {
    sku?: string | null;
    barcode?: string | null;
    unit: string;
  };
}

interface ExpiringProductBatch {
  id: string;
  batchNumber?: string | null;
  expiryDate?: string | null;
  quantity?: string | number | null;
  product?: {
    name?: string | null;
    sku?: string | null;
  } | null;
}

export function InventoryClient() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<InventoryView>("products");
  const [showProductForm, setShowProductForm] = useState(false);
  const [showStockAdjustment, setShowStockAdjustment] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [importStatus, setImportStatus] = useState("");
  const pageSize = 25;
  const searchTerm = search.trim();
  const verticalConfig = getStoredVerticalConfig();
  const role = getStoredAuthSession()?.user?.role;
  const canManageProducts = role === "OWNER" || role === "MANAGER";
  const supportsExpiryAlerts = Boolean(verticalConfig?.expiryAlerts?.enabled);
  const productsQuery = useQuery({
    queryKey: ["products", lowStockOnly, searchTerm, page, pageSize],
    queryFn: () => listProducts({
      lowStock: lowStockOnly,
      page,
      limit: pageSize,
      ...(searchTerm ? { search: searchTerm } : {}),
    }),
  });
  const lowStockCountQuery = useQuery({
    queryKey: ["products", "low-stock-count"],
    queryFn: () => listProducts({ lowStock: true, page: 1, limit: 1 }),
    staleTime: 60_000,
  });
  const expiringQuery = useQuery({
    queryKey: ["expiring-products"],
    queryFn: () => createAuthenticatedApiClient().get<unknown[]>("/inventory/products/expiring?days=30"),
    enabled: supportsExpiryAlerts,
    retry: false,
  });
  const products = productsQuery.data?.data ?? [];
  useEffect(() => {
    setPage(1);
  }, [lowStockOnly, searchTerm]);
  const importProducts = useMutation({
    mutationFn: (file: File) => createAuthenticatedApiClient().upload<ImportResult>("/inventory/products/import", file),
    onSuccess: async (result) => {
      setImportStatus(`Imported ${String(result.created)} new and ${String(result.updated)} updated. Failed ${String(result.failed)}.`);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
  const lowStockCount = lowStockCountQuery.data?.total ?? 0;
  const stockValue = products.reduce((sum, product) => sum + Number(product.currentStock) * Number(product.purchasePrice ?? product.sellingPrice), 0);

  return (
    <>
      <StatStrip
        items={[
          { label: "Active products", value: String(productsQuery.data?.total ?? products.length), tone: "blue" },
          { label: "Low stock", value: String(lowStockCount), tone: "amber" },
          ...(supportsExpiryAlerts ? [{ label: "Expiring soon", value: String(expiringQuery.data?.length ?? 0), tone: "emerald" as const }] : []),
          { label: "Visible stock value", value: `₹${stockValue.toFixed(2)}`, tone: "slate" },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`h-10 rounded-md border px-4 text-sm font-semibold ${activeView === "products" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border text-slate-600"}`} onClick={() => setActiveView("products")}>Products</button>
        <button type="button" className={`h-10 rounded-md border px-4 text-sm font-semibold ${activeView === "stock-count" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border text-slate-600"}`} onClick={() => setActiveView("stock-count")}>Stock Count</button>
        {supportsExpiryAlerts ? (
          <button type="button" className={`h-10 rounded-md border px-4 text-sm font-semibold ${activeView === "expiry" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border text-slate-600"}`} onClick={() => setActiveView("expiry")}>Expiry Dashboard</button>
        ) : null}
      </div>
      {activeView === "stock-count" ? (
        <StockCountWorkspace canManage={canManageProducts} onStockChanged={() => void queryClient.invalidateQueries({ queryKey: ["products"] })} />
      ) : activeView === "expiry" ? (
        <ExpiryDashboard />
      ) : (
        <div className="space-y-4">
          {canManageProducts && showProductForm ? (
            <ProductFieldForm onCreated={() => {
              setShowProductForm(false);
              void productsQuery.refetch();
            }} />
          ) : null}
          {showStockAdjustment ? (
            <StockAdjustment onSaved={() => {
              setShowStockAdjustment(false);
              void queryClient.invalidateQueries({ queryKey: ["products"] });
            }} />
          ) : null}
          <section className="rounded-md border border-border bg-white">
          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-950">Products</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {canManageProducts ? (
                  <>
                    <button type="button" className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white" onClick={() => setShowProductForm((value) => !value)}>
                      {showProductForm ? "Hide product form" : "New product"}
                    </button>
                    <button type="button" className="h-9 rounded-md border border-border px-3 text-sm font-semibold text-slate-700" onClick={() => setShowStockAdjustment((value) => !value)}>
                      {showStockAdjustment ? "Hide adjustment" : "Stock adjustment"}
                    </button>
                  </>
                ) : null}
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} className="size-4 accent-emerald-600" />
                  Low stock
                </label>
              </div>
            </div>
            {canManageProducts ? (
              <div className="flex flex-wrap items-center gap-2">
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void downloadApiFile("/inventory/products/template", "bizbil-product-template.xls")}>
                  <FileSpreadsheet className="size-4 text-emerald-700" aria-hidden="true" />
                  Template
                </button>
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void downloadApiFile("/inventory/products/export?format=csv", "bizbil-products-export.csv")}>
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
            ) : null}
            {importStatus ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{importStatus}</div> : null}
            {importProducts.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{importProducts.error.message}</div> : null}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product name, Product ID, barcode" className="h-10 w-full rounded-md border border-border px-9 text-sm outline-none focus:border-emerald-600" />
              {search ? (
                <button type="button" aria-label="Clear product search" className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setSearch("")}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <ProductList products={products} loading={productsQuery.isLoading} error={productsQuery.error} hasSearch={Boolean(searchTerm)} canManageProducts={canManageProducts} />
          <PaginationControls page={page} limit={pageSize} total={productsQuery.data?.total ?? 0} onPageChange={setPage} />
          </section>
        </div>
      )}
    </>
  );
}

function ExpiryDashboard() {
  const thirtyDaysQuery = useQuery({
    queryKey: ["expiring-products", 30],
    queryFn: () => createAuthenticatedApiClient().get<ExpiringProductBatch[]>("/inventory/products/expiring?days=30"),
    retry: false,
  });
  const sixtyDaysQuery = useQuery({
    queryKey: ["expiring-products", 60],
    queryFn: () => createAuthenticatedApiClient().get<ExpiringProductBatch[]>("/inventory/products/expiring?days=60"),
    retry: false,
  });
  const ninetyDaysQuery = useQuery({
    queryKey: ["expiring-products", 90],
    queryFn: () => createAuthenticatedApiClient().get<ExpiringProductBatch[]>("/inventory/products/expiring?days=90"),
    retry: false,
  });
  const buckets = [
    { days: 30, label: "Next 30 days", tone: "red", query: thirtyDaysQuery },
    { days: 60, label: "31-60 days", tone: "amber", query: sixtyDaysQuery },
    { days: 90, label: "61-90 days", tone: "emerald", query: ninetyDaysQuery },
  ] as const;

  return (
    <section className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-slate-950">Expiry dashboard</div>
        <div className="text-sm text-slate-500">Batches grouped by 30, 60, and 90 day windows.</div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {buckets.map((bucket) => {
          const records = bucket.query.data ?? [];
          return (
            <div key={bucket.days} className={`rounded-md border p-3 ${expiryToneClass(bucket.tone)}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{bucket.label}</div>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold">{records.length}</span>
              </div>
              {bucket.query.isLoading ? (
                <div className="text-sm text-slate-500">Loading expiring batches...</div>
              ) : bucket.query.error ? (
                <div className="text-sm text-red-700">{bucket.query.error.message}</div>
              ) : records.length === 0 ? (
                <div className="text-sm text-slate-500">No batches in this window.</div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {records.map((batch) => (
                    <div key={batch.id} className="rounded-md bg-white/80 p-2 text-sm">
                      <div className="font-medium text-slate-950">{batch.product?.name ?? "Product"}</div>
                      <div className="text-xs text-slate-500">
                        Batch {batch.batchNumber || "-"} | Qty {batch.quantity ?? "-"} | Exp {batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString("en-IN") : "-"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function expiryToneClass(tone: "red" | "amber" | "emerald"): string {
  if (tone === "red") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

function StockCountWorkspace({ canManage, onStockChanged }: Readonly<{ canManage: boolean; onStockChanged: () => void }>) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newCountName, setNewCountName] = useState("");
  const [search, setSearch] = useState("");
  const [countValues, setCountValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const countsQuery = useQuery({
    queryKey: ["stock-counts", status],
    queryFn: () => {
      const query = new URLSearchParams();
      if (status) {
        query.set("status", status);
      }

      return createAuthenticatedApiClient().get<StockCountSummary[]>(`/inventory/stock-counts${query.toString() ? `?${query.toString()}` : ""}`);
    },
  });
  const detailQuery = useQuery({
    queryKey: ["stock-count", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => createAuthenticatedApiClient().get<StockCountDetail>(`/inventory/stock-counts/${selectedId ?? ""}`),
  });
  const startCount = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<StockCountDetail>("/inventory/stock-counts", newCountName.trim() ? { name: newCountName.trim() } : {}),
    onSuccess: async (count) => {
      setSelectedId(count.id);
      setNewCountName("");
      setMessage("Stock count started.");
      await queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
    },
  });
  const saveItems = useMutation({
    mutationFn: () => createAuthenticatedApiClient().put<StockCountDetail>(`/inventory/stock-counts/${selectedId ?? ""}/items`, {
      items: Object.entries(countValues).flatMap(([productId, value]) => {
        const trimmed = value.trim();
        const countedQty = Number(trimmed);
        return trimmed && Number.isFinite(countedQty) ? [{ productId, countedQty }] : [];
      }),
    }),
    onSuccess: async (count) => {
      setMessage("Counted quantities saved.");
      queryClient.setQueryData(["stock-count", count.id], count);
      await queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
    },
  });
  const submitCount = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<StockCountDetail>(`/inventory/stock-counts/${selectedId ?? ""}/submit`, {}),
    onSuccess: async (count) => {
      setMessage("Stock count submitted for approval.");
      queryClient.setQueryData(["stock-count", count.id], count);
      await queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
    },
  });
  const approveCount = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<StockCountDetail>(`/inventory/stock-counts/${selectedId ?? ""}/approve`, {}),
    onSuccess: async (count) => {
      setMessage("Stock variances applied.");
      queryClient.setQueryData(["stock-count", count.id], count);
      await queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
      onStockChanged();
    },
  });
  const cancelCount = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<StockCountDetail>(`/inventory/stock-counts/${selectedId ?? ""}/cancel`, {}),
    onSuccess: async (count) => {
      setMessage("Stock count cancelled.");
      queryClient.setQueryData(["stock-count", count.id], count);
      await queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
    },
  });

  const counts = countsQuery.data ?? [];
  const detail = detailQuery.data ?? null;
  const filteredItems = (detail?.items ?? []).filter((item) => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return true;
    }

    return [item.productName, item.product.sku, item.product.barcode].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
  });
  const error = countsQuery.error ?? detailQuery.error ?? startCount.error ?? saveItems.error ?? submitCount.error ?? approveCount.error ?? cancelCount.error;
  const busy = startCount.isPending || saveItems.isPending || submitCount.isPending || approveCount.isPending || cancelCount.isPending;

  useEffect(() => {
    if (!selectedId && counts[0]) {
      setSelectedId(counts[0].id);
    }
  }, [counts, selectedId]);

  useEffect(() => {
    if (!detail) {
      setCountValues({});
      return;
    }

    setCountValues(Object.fromEntries(detail.items.map((item) => [item.productId, item.countedQty === null ? "" : String(Number(item.countedQty))])));
  }, [detail?.id, detail?.items, detail?.status]);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-slate-950">Physical stock counts</div>
          <p className="text-xs text-slate-500">Snapshot stock, enter counted quantities, then approve variances.</p>
          <div className="mt-3 flex gap-2">
            <select value={status} onChange={(event) => { setStatus(event.target.value); setSelectedId(null); }} className="h-9 rounded-md border border-border px-2 text-sm">
              <option value="">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="APPROVED">Approved</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          {canManage ? (
            <div className="mt-3 flex gap-2">
              <input value={newCountName} onChange={(event) => setNewCountName(event.target.value)} placeholder="Count name (optional)" className="h-9 min-w-0 flex-1 rounded-md border border-border px-3 text-sm" />
              <button type="button" className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-60" disabled={startCount.isPending} onClick={() => startCount.mutate()}>
                Start
              </button>
            </div>
          ) : null}
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          {countsQuery.isLoading ? <div className="p-4 text-sm text-slate-500">Loading stock counts...</div> : null}
          {!countsQuery.isLoading && counts.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">No stock counts yet.</div> : null}
          {counts.map((count) => (
            <button key={count.id} type="button" className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-slate-50 ${selectedId === count.id ? "bg-emerald-50" : "bg-white"}`} onClick={() => { setSelectedId(count.id); setMessage(""); }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-950">{count.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{new Date(count.countedAt).toLocaleDateString("en-IN")} | {count._count.items} products</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${stockCountStatusClass(count.status)}`}>{count.status}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-border bg-white">
        {!detail ? (
          <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500">Select or start a stock count.</div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{detail.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">{new Date(detail.countedAt).toLocaleString("en-IN")} | {detail.items.length} products</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${stockCountStatusClass(detail.status)}`}>{detail.status}</span>
              </div>
              {message ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
              {error ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="h-10 rounded-md border border-border px-3 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={busy || detail.status !== "OPEN" || !canManage} onClick={() => saveItems.mutate()}>Save counts</button>
                <button type="button" className="h-10 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || detail.status !== "OPEN" || !canManage} onClick={() => submitCount.mutate()}>Submit</button>
                <button type="button" className="h-10 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || detail.status !== "SUBMITTED" || !canManage} onClick={() => approveCount.mutate()}>Approve & apply</button>
                <button type="button" className="h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy || detail.status !== "OPEN" || !canManage} onClick={() => cancelCount.mutate()}>Cancel</button>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU, barcode" className="h-10 w-full rounded-md border border-border px-9 text-sm outline-none focus:border-emerald-600" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Barcode / SKU</th>
                    <th className="px-4 py-2 text-right">System</th>
                    <th className="px-4 py-2 text-right">Counted</th>
                    <th className="px-4 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No products match this search.</td>
                    </tr>
                  ) : null}
                  {filteredItems.map((item) => {
                    const countedValue = countValues[item.productId] ?? "";
                    const countedNumber = countedValue.trim() ? Number(countedValue) : Number(item.countedQty ?? item.systemQty);
                    const variance = roundQuantity(countedNumber - Number(item.systemQty));
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-4 py-2 font-medium text-slate-900">{item.productName}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{item.product.barcode || "-"} / {item.product.sku || "-"}</td>
                        <td className="px-4 py-2 text-right">{Number(item.systemQty).toFixed(3)} {item.product.unit}</td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={countedValue}
                            disabled={detail.status !== "OPEN" || !canManage}
                            onChange={(event) => setCountValues((current) => ({ ...current, [item.productId]: event.target.value }))}
                            className="h-9 w-28 rounded-md border border-border px-2 text-right text-sm disabled:bg-slate-50"
                          />
                        </td>
                        <td className={`px-4 py-2 text-right font-semibold ${variance < 0 ? "text-red-700" : variance > 0 ? "text-emerald-700" : "text-slate-600"}`}>
                          {variance.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ProductList({ products, loading, error, hasSearch, canManageProducts }: Readonly<{ products: ProductRecord[]; loading: boolean; error: Error | null; hasSearch: boolean; canManageProducts: boolean }>) {
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
        <div className="p-4 text-sm text-slate-500">{hasSearch ? "No products found." : "No products yet. Use New product to add your first item."}</div>
      ) : (
        products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            showBatchTools={(verticalConfig?.batchFields?.length ?? 0) > 0}
            canManageProducts={canManageProducts}
            onUpdate={(payload) => updateProduct.mutate({ id: product.id, payload })}
            onDelete={() => {
              if (window.confirm(`Delete ${product.name}? This will hide it from billing and inventory lists.`)) {
                deleteProduct.mutate(product.id);
              }
            }}
            onBatch={(payload) => addBatch.mutate({ id: product.id, payload })}
          />
        ))
      )}
    </div>
  );
}

function ProductImageControls({
  canManage,
  productId,
  productName,
  imageSrc,
  uploadPending,
  removePending,
  error,
  onUpload,
  onRemove,
}: Readonly<{
  canManage: boolean;
  productId: string;
  productName: string;
  imageSrc: string | null;
  uploadPending: boolean;
  removePending: boolean;
  error: Error | null;
  onUpload: (file: File | undefined) => void;
  onRemove: () => void;
}>) {
  const queryClient = useQueryClient();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsQueryKey = ["product-image-suggestions", productId];
  const suggestionsQuery = useQuery({
    queryKey: suggestionsQueryKey,
    queryFn: () => createAuthenticatedApiClient().get<ProductImageSuggestionsResponse>(`/inventory/products/${productId}/image-suggestions`),
    enabled: canManage && showSuggestions,
  });
  const searchSuggestions = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<ProductImageSuggestionsResponse>(`/inventory/products/${productId}/image-suggestions/search`, { limit: 6 }),
    onSuccess: (data) => {
      queryClient.setQueryData(suggestionsQueryKey, data);
    },
  });
  const applySuggestion = useMutation({
    mutationFn: (suggestionId: string) => createAuthenticatedApiClient().post(`/inventory/products/${productId}/image-suggestions/${suggestionId}/apply`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: suggestionsQueryKey }),
      ]);
    },
  });
  const rejectSuggestion = useMutation({
    mutationFn: (suggestionId: string) => createAuthenticatedApiClient().post(`/inventory/products/${productId}/image-suggestions/${suggestionId}/reject`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: suggestionsQueryKey }),
  });
  const suggestionsData = suggestionsQuery.data;
  const suggestions = suggestionsData?.suggestions ?? [];

  function findImages() {
    setShowSuggestions(true);
    searchSuggestions.mutate();
  }

  return (
    <div className="md:col-span-2 rounded-md border border-border bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProductImageThumb src={imageSrc} name="Product image" large />
        {canManage ? (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900">Product image</div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {uploadPending ? "Uploading..." : imageSrc ? "Change image" : "Upload image"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => {
                  onUpload(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }} />
              </label>
              {imageSrc ? (
                <button type="button" className="h-9 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50" disabled={removePending} onClick={onRemove}>
                  Remove
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                disabled={searchSuggestions.isPending}
                onClick={findImages}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                {searchSuggestions.isPending ? "Finding..." : "Find images"}
              </button>
            </div>
            {error ? <div className="text-xs text-red-700">{error.message}</div> : null}
            {searchSuggestions.error ? <div className="text-xs text-red-700">{searchSuggestions.error.message}</div> : null}
            {applySuggestion.error ? <div className="text-xs text-red-700">{applySuggestion.error.message}</div> : null}
          </div>
        ) : null}
      </div>
      {showSuggestions ? (
        <div className="mt-4 rounded-md border border-border bg-white p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ImageIcon className="size-4 text-emerald-700" aria-hidden="true" />
                Image suggestions
              </div>
              <div className="mt-1 text-xs text-slate-500">Review the source before using a suggested product image.</div>
            </div>
            <button
              type="button"
              className="h-8 rounded-md border border-border px-3 text-xs font-medium text-slate-700"
              disabled={searchSuggestions.isPending}
              onClick={findImages}
            >
              Refresh
            </button>
          </div>

          {suggestionsQuery.isLoading ? <div className="mt-3 text-sm text-slate-500">Loading image suggestions...</div> : null}
          {suggestionsData && !suggestionsData.configured ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              BizBil image discovery is not enabled on this server yet. This is platform setup, not a shop license.
            </div>
          ) : null}
          {!suggestionsQuery.isLoading && suggestionsData?.configured && suggestions.length === 0 ? (
            <div className="mt-3 text-sm text-slate-500">No image suggestions found for {productName}.</div>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suggestions.map((suggestion) => (
                <ProductImageSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  applying={applySuggestion.isPending}
                  rejecting={rejectSuggestion.isPending}
                  onApply={() => applySuggestion.mutate(suggestion.id)}
                  onReject={() => rejectSuggestion.mutate(suggestion.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProductImageSuggestionCard({
  suggestion,
  applying,
  rejecting,
  onApply,
  onReject,
}: Readonly<{
  suggestion: ProductImageSuggestion;
  applying: boolean;
  rejecting: boolean;
  onApply: () => void;
  onReject: () => void;
}>) {
  const sourceHost = suggestion.contextUrl ? safeHost(suggestion.contextUrl) : safeHost(suggestion.sourceImageUrl);

  return (
    <article className={`overflow-hidden rounded-md border ${suggestion.status === "APPROVED" ? "border-emerald-300 bg-emerald-50" : "border-border bg-white"}`}>
      <div className="aspect-square bg-slate-100">
        {suggestion.thumbnailUrl ? (
          <img
            src={suggestion.thumbnailUrl}
            alt={suggestion.title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full place-items-center text-xs font-semibold uppercase text-slate-400">No preview</div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase ${imageRelevanceClass(suggestion.relevance)}`}>
            {suggestion.relevance === "VERY_RELEVANT" ? "Very relevant" : suggestion.relevance === "RELEVANT" ? "Relevant" : "Review"}
          </span>
          <span className="text-xs font-semibold text-slate-500">{suggestion.score}%</span>
        </div>
        <div className="line-clamp-2 min-h-[36px] text-xs font-semibold leading-5 text-slate-900">{suggestion.title}</div>
        <div className="truncate text-xs text-slate-500">{sourceHost}</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-60"
            disabled={applying || suggestion.status === "APPROVED"}
            onClick={onApply}
          >
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {suggestion.status === "APPROVED" ? "Used" : "Use image"}
          </button>
          {suggestion.status !== "APPROVED" ? (
            <button
              type="button"
              className="h-8 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:opacity-60"
              disabled={rejecting || suggestion.status === "REJECTED"}
              onClick={onReject}
            >
              {suggestion.status === "REJECTED" ? "Rejected" : "Reject"}
            </button>
          ) : null}
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600"
            href={suggestion.contextUrl ?? suggestion.sourceImageUrl}
            target="_blank"
            rel="noreferrer"
          >
            Source
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
}

function ProductImageThumb({ src, name, large = false }: Readonly<{ src: string | null; name: string; large?: boolean }>) {
  const sizeClass = large ? "size-20" : "size-12";
  if (!src) {
    return (
      <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-[10px] font-semibold uppercase text-slate-400`}>
        Image
      </div>
    );
  }

  return <img src={src} alt={`${name} product image`} className={`${sizeClass} shrink-0 rounded-md border border-border object-cover`} />;
}

function imageRelevanceClass(relevance: ProductImageSuggestion["relevance"]): string {
  if (relevance === "VERY_RELEVANT") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (relevance === "RELEVANT") {
    return "bg-blue-100 text-blue-800";
  }
  return "bg-amber-100 text-amber-800";
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "image source";
  }
}

function SellOnlineSwitch({ checked, disabled, onChange }: Readonly<{ checked: boolean; disabled: boolean; onChange: () => void }>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? "Turn off online selling for this product" : "Turn on online selling for this product"}
      title={checked ? "Sell online on" : "Sell online off"}
      disabled={disabled}
      onClick={onChange}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>Sell Online</span>
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true">
        <span className={`size-4 rounded-full bg-white shadow-sm transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

function ProductRow({ product, showBatchTools, canManageProducts, onUpdate, onDelete, onBatch }: Readonly<{ product: ProductRecord; showBatchTools: boolean; canManageProducts: boolean; onUpdate: (payload: object) => void; onDelete: () => void; onBatch: (payload: object) => void }>) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showBatches, setShowBatches] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showFamilyManager, setShowFamilyManager] = useState(false);
  const gstEnabled = getStoredTenant()?.gstEnabled !== false;
  const imageSrc = product.imageUrl ? `${apiUrl(`/inventory/products/${product.id}/image`)}?v=${encodeURIComponent(product.imageUrl)}` : null;
  const stockQuantity = Number(product.currentStock);
  const canSellOnline = product.ecommerceDisabled !== true && stockQuantity > 0;
  const onlineStatus = product.ecommerceDisabled === true ? "Offline" : stockQuantity <= 0 ? "Out of stock" : "Online";
  const batchesQuery = useQuery({
    queryKey: ["product-batches", product.id],
    queryFn: () => createAuthenticatedApiClient().get<ProductBatch[]>(`/inventory/products/${product.id}/batches`),
    enabled: showBatches,
    retry: false,
  });
  const movementsQuery = useQuery({
    queryKey: ["product-movements", product.id],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedMovements>(`/inventory/products/${product.id}/movements?limit=25`),
    enabled: showHistory,
  });
  const uploadImage = useMutation({
    mutationFn: (file: File) => createAuthenticatedApiClient().upload<{ imageUrl: string }>(`/inventory/products/${product.id}/image`, file),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
  const removeImage = useMutation({
    mutationFn: () => createAuthenticatedApiClient().delete<{ imageUrl: null }>(`/inventory/products/${product.id}/image`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
  const suggestionsQueryKey = ["product-image-suggestions", product.id];
  const suggestionsQuery = useQuery({
    queryKey: suggestionsQueryKey,
    queryFn: () => createAuthenticatedApiClient().get<ProductImageSuggestionsResponse>(`/inventory/products/${product.id}/image-suggestions`),
    enabled: canManageProducts && showSuggestions,
  });
  const searchSuggestions = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<ProductImageSuggestionsResponse>(`/inventory/products/${product.id}/image-suggestions/search`, { limit: 6 }),
    onSuccess: (data) => {
      setShowSuggestions(true);
      queryClient.setQueryData(suggestionsQueryKey, data);
    },
  });
  const applySuggestion = useMutation({
    mutationFn: (suggestionId: string) => createAuthenticatedApiClient().post(`/inventory/products/${product.id}/image-suggestions/${suggestionId}/apply`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: suggestionsQueryKey }),
      ]);
    },
  });
  const rejectSuggestion = useMutation({
    mutationFn: (suggestionId: string) => createAuthenticatedApiClient().post(`/inventory/products/${product.id}/image-suggestions/${suggestionId}/reject`, {}),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: suggestionsQueryKey }),
  });
  const suggestionsData = suggestionsQuery.data ?? searchSuggestions.data;
  const suggestions = suggestionsData?.suggestions ?? [];

  function handleImageInput(file: File | undefined) {
    if (file) {
      uploadImage.mutate(file);
    }
  }

  function findImages() {
    setShowSuggestions(true);
    searchSuggestions.mutate();
  }

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
      ecommerceDisabled: form.get("ecommerceDisabled") !== "on",
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
        <form className="grid max-h-[90vh] w-full max-w-4xl gap-3 overflow-y-auto rounded-md border border-border bg-white p-4 shadow-xl md:grid-cols-2" onSubmit={handleEdit}>
          <div className="flex items-start justify-between gap-3 md:col-span-2">
            <div>
              <div className="text-base font-semibold text-slate-950">Edit product</div>
              <div className="text-sm text-slate-500">{product.name}</div>
            </div>
            <button type="button" className="inline-flex size-9 items-center justify-center rounded-md border border-border text-slate-600" onClick={() => setEditing(false)} aria-label="Close edit product">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <ProductImageControls
            canManage={canManageProducts}
            productId={product.id}
            productName={product.name}
            imageSrc={imageSrc}
            uploadPending={uploadImage.isPending}
            removePending={removeImage.isPending}
            error={uploadImage.error ?? removeImage.error}
            onUpload={handleImageInput}
            onRemove={() => removeImage.mutate()}
          />
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
          {gstEnabled ? (
            <>
              <TextInput name="gstRate" label="GST %" type="number" defaultValue={String(product.gstRate)} required />
              <TextInput name="cessRate" label="CESS %" type="number" defaultValue={String(product.cessRate ?? 0)} />
              <TextInput name="hsnCode" label="HSN / SAC code" defaultValue={product.hsnCode ?? ""} />
            </>
          ) : null}
          <TextInput name="reorderLevel" label="Reorder level" type="number" defaultValue={String(product.reorderLevel ?? "")} />
          <TextInput name="purchaseUnit" label="Purchase unit" defaultValue={product.purchaseUnit ?? ""} />
          <TextInput name="salesUnit" label="Sales unit" defaultValue={product.salesUnit ?? ""} />
          <TextInput name="alternateUnit" label="Alter unit" defaultValue={product.alternateUnit ?? ""} />
          <TextInput name="conversionValue" label="Conversion value" type="number" defaultValue={String(product.conversionValue ?? "")} />
          <TextInput name="godown" label="Godown" defaultValue={product.godown ?? ""} />
          <TextInput name="rack" label="Rack" defaultValue={product.rack ?? ""} />
          <TextInput name="defaultSaleQty" label="Default sale qty" type="number" defaultValue={String(product.defaultSaleQty ?? "")} />
          <label className="flex items-center gap-3 rounded-md border border-border bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              name="ecommerceDisabled"
              type="checkbox"
              className="size-4 accent-emerald-600"
              defaultChecked={product.ecommerceDisabled !== true}
            />
            Sell this product online
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white">Save changes</button>
            <button type="button" className="h-10 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <article className="p-4">
      <div className="grid items-center gap-3 lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
        <div className="flex min-w-0 gap-3">
          <ProductImageThumb src={imageSrc} name={product.name} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="truncate text-sm font-medium text-slate-950">{product.name}</div>
              <span className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold ${canSellOnline ? "bg-emerald-50 text-emerald-700" : stockQuantity <= 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}>
                {onlineStatus}
              </span>
            </div>
             <div className="text-xs text-slate-500">{product.unit}{gstEnabled ? ` | GST ${String(product.gstRate)}%` : ""}{product.sku ? ` | SKU ${product.sku}` : ""}</div>
             <div className="mt-1 text-xs text-slate-500">Stock {Number(product.currentStock)} | Reorder {product.reorderLevel ?? "not set"}{product.rack ? ` | Rack ${product.rack}` : ""}</div>
             {product.ecommerceFamily ? (
               <div className="mt-2 flex flex-wrap items-center gap-2">
                 <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                   <Boxes className="size-3.5" aria-hidden="true" />
                   {product.ecommerceFamily.familyName}
                 </span>
                 <span className="text-xs text-slate-500">
                   {product.ecommerceFamily.attributeLabel}: {product.ecommerceFamily.variantLabel} | {product.ecommerceFamily.memberCount} variants
                 </span>
               </div>
             ) : null}
           </div>
         </div>
        {canManageProducts ? (
          <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-center">
            <SellOnlineSwitch
              checked={canSellOnline}
              disabled={stockQuantity <= 0}
              onChange={() => onUpdate({ ecommerceDisabled: product.ecommerceDisabled !== true })}
            />
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
              {uploadImage.isPending ? "Uploading..." : imageSrc ? "Change image" : "Upload image"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => {
                handleImageInput(event.target.files?.[0]);
                event.currentTarget.value = "";
              }} />
            </label>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              disabled={searchSuggestions.isPending}
              onClick={findImages}
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {searchSuggestions.isPending ? "Finding..." : "Find images"}
            </button>
            {imageSrc ? (
              <button type="button" className="h-9 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50" disabled={removeImage.isPending} onClick={() => removeImage.mutate()}>
                Remove image
              </button>
            ) : null}
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => setShowHistory((value) => !value)}
            >
              <History className="size-3.5" aria-hidden="true" />
              {showHistory ? "Hide history" : "Stock history"}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"
              onClick={() => setShowFamilyManager(true)}
            >
              <Boxes className="size-3.5" aria-hidden="true" />
              {product.ecommerceFamily ? "Variant group" : "Create group"}
            </button>
            {uploadImage.error ?? removeImage.error ? <span className="basis-full text-xs text-red-700">{(uploadImage.error ?? removeImage.error)?.message}</span> : null}
            {searchSuggestions.error ? <span className="basis-full text-xs text-red-700">{searchSuggestions.error.message}</span> : null}
            {applySuggestion.error ? <span className="basis-full text-xs text-red-700">{applySuggestion.error.message}</span> : null}
          </div>
        ) : null}
        {canManageProducts ? (
          <div className="flex justify-start gap-2 lg:justify-end">
            <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => setEditing(true)}>Edit</button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700" onClick={onDelete}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </button>
          </div>
        ) : null}
      </div>
      {!canManageProducts ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-slate-700"
            onClick={() => setShowHistory((value) => !value)}
          >
            <History className="size-3.5" aria-hidden="true" />
            {showHistory ? "Hide stock history" : "Stock history"}
          </button>
        </div>
      ) : null}
      {showSuggestions ? (
        <div className="mt-3 rounded-md border border-border bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ImageIcon className="size-4 text-emerald-700" aria-hidden="true" />
                Image suggestions
              </div>
              <div className="mt-1 text-xs text-slate-500">Review the source before using a suggested product image.</div>
            </div>
            <button type="button" className="h-8 rounded-md border border-border bg-white px-3 text-xs font-medium text-slate-700" disabled={searchSuggestions.isPending} onClick={findImages}>
              Refresh
            </button>
          </div>
          {suggestionsQuery.isLoading ? <div className="mt-3 text-sm text-slate-500">Loading image suggestions...</div> : null}
          {suggestionsData && !suggestionsData.configured ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              BizBil image discovery is not enabled on this server yet. This is platform setup, not a shop license.
            </div>
          ) : null}
          {!suggestionsQuery.isLoading && suggestionsData?.configured && suggestions.length === 0 ? (
            <div className="mt-3 text-sm text-slate-500">No image suggestions found for {product.name}.</div>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {suggestions.map((suggestion) => (
                <ProductImageSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  applying={applySuggestion.isPending}
                  rejecting={rejectSuggestion.isPending}
                  onApply={() => applySuggestion.mutate(suggestion.id)}
                  onReject={() => rejectSuggestion.mutate(suggestion.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
      {showHistory ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-500">Stock history</div>
          {movementsQuery.isLoading ? (
            <div className="p-3 text-sm text-slate-500">Loading stock movement...</div>
          ) : movementsQuery.error ? (
            <div className="p-3 text-sm text-red-700">{movementsQuery.error.message}</div>
          ) : (movementsQuery.data?.data ?? []).length === 0 ? (
            <div className="p-3 text-sm text-slate-500">No stock movement recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium">Change</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                    <th className="px-3 py-2 text-left font-medium">Reference</th>
                    <th className="px-3 py-2 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(movementsQuery.data?.data ?? []).map((movement, index) => (
                    <tr key={`${movement.date}-${movement.reference}-${String(index)}`}>
                      <td className="px-3 py-2">{new Date(movement.date).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 capitalize">{movement.type}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${movement.qty >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {movement.qty}
                      </td>
                      <td className="px-3 py-2 text-right">{movement.runningBalance}</td>
                      <td className="px-3 py-2">{movement.reference}</td>
                      <td className="px-3 py-2 text-slate-500">{movement.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      {showFamilyManager ? (
        <ProductFamilyManagerDialog
          product={product}
          onClose={() => setShowFamilyManager(false)}
          onUpdated={async () => {
            await queryClient.invalidateQueries({ queryKey: ["products"] });
          }}
        />
      ) : null}
    </article>
  );
}

function ProductFamilyManagerDialog({
  product,
  onClose,
  onUpdated,
}: Readonly<{
  product: ProductRecord;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}>) {
  const api = createAuthenticatedApiClient();
  const queryClient = useQueryClient();
  const familiesQueryKey = ["inventory", "ecommerce-families"];
  const [familySearch, setFamilySearch] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [attributeLabel, setAttributeLabel] = useState("Size");
  const [variantLabel, setVariantLabel] = useState("");
  const [targetFamilyId, setTargetFamilyId] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [selectedAdditionalProductIds, setSelectedAdditionalProductIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const familiesQuery = useQuery({
    queryKey: familiesQueryKey,
    queryFn: () => api.get<EcommerceFamilyCatalogResponse>("/storefront/product-families"),
  });
  const familyData = familiesQuery.data;
  const currentFamily = familyData?.families.find((family) => family.items.some((item) => item.productId === product.id)) ?? null;
  const currentItem = currentFamily?.items.find((item) => item.productId === product.id) ?? null;
  const matchingSuggestion = familyData?.suggestions.find((suggestion) => suggestion.items.some((item) => item.productId === product.id)) ?? null;
  const filteredUngroupedProducts = (familyData?.ungroupedProducts ?? [])
    .filter((candidate) => candidate.id !== product.id)
    .filter((candidate) => {
      const query = familySearch.trim().toLowerCase();
      if (!query) {
        return true;
      }

      return [
        candidate.name,
        candidate.sku,
        candidate.barcode,
        candidate.brand,
        candidate.categoryName,
        candidate.suggestedVariantLabel,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });

  useEffect(() => {
    const suggestedItem = matchingSuggestion?.items.find((item) => item.productId === product.id);
    setFamilyName(currentFamily?.name ?? matchingSuggestion?.name ?? stripSizeSuffix(product.name));
    setAttributeLabel(currentFamily?.attributeLabel ?? matchingSuggestion?.attributeLabel ?? "Size");
    setVariantLabel(currentItem?.variantLabel ?? suggestedItem?.variantLabel ?? product.ecommerceFamily?.variantLabel ?? product.name);
    setTargetFamilyId(currentFamily?.id ?? "");
    setMakeDefault(currentItem?.isDefault ?? false);
    setSelectedAdditionalProductIds([]);
    setFamilySearch("");
    setNotice("");
    setError("");
  }, [currentFamily?.attributeLabel, currentFamily?.id, currentFamily?.name, currentItem?.isDefault, currentItem?.variantLabel, matchingSuggestion?.attributeLabel, matchingSuggestion?.items, matchingSuggestion?.name, product.ecommerceFamily?.variantLabel, product.name]);

  const createSuggestedFamily = useMutation({
    mutationFn: async () => {
      if (!matchingSuggestion) {
        throw new Error("No suggested variant group is available for this product");
      }

      return api.post("/storefront/product-families", {
        name: matchingSuggestion.name,
        attributeLabel: matchingSuggestion.attributeLabel,
        source: "SUGGESTED",
        items: matchingSuggestion.items.map((item, index) => ({
          productId: item.productId,
          variantLabel: item.variantLabel,
          sortOrder: item.sortOrder,
          isDefault: index === 0,
        })),
      });
    },
    onSuccess: async () => {
      setNotice("Suggested variant group created.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familiesQueryKey }),
        onUpdated(),
      ]);
    },
    onError: (mutationError) => setError(readErrorMessage(mutationError)),
  });

  const createManualFamily = useMutation({
    mutationFn: async () => {
      const selectedProducts = filteredUngroupedProducts.filter((candidate) => selectedAdditionalProductIds.includes(candidate.id));
      if (!familyName.trim()) {
        throw new Error("Family name is required");
      }
      if (selectedProducts.length === 0) {
        throw new Error("Select at least one more product to create a family");
      }

      return api.post("/storefront/product-families", {
        name: familyName.trim(),
        attributeLabel: attributeLabel.trim() || "Size",
        source: "MANUAL",
        items: [
          {
            productId: product.id,
            variantLabel: variantLabel.trim() || product.name,
            sortOrder: 0,
            isDefault: true,
          },
          ...selectedProducts.map((candidate, index) => ({
            productId: candidate.id,
            variantLabel: candidate.suggestedVariantLabel ?? candidate.size ?? candidate.name,
            sortOrder: index + 1,
            isDefault: false,
          })),
        ],
      });
    },
    onSuccess: async () => {
      setNotice("Variant family created from POS.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familiesQueryKey }),
        onUpdated(),
      ]);
    },
    onError: (mutationError) => setError(readErrorMessage(mutationError)),
  });

  const addProductsToFamily = useMutation({
    mutationFn: async (familyId: string) => {
      if (!familyId) {
        throw new Error("Choose a family first");
      }

      const selectedProducts = filteredUngroupedProducts.filter((candidate) => selectedAdditionalProductIds.includes(candidate.id));
      const addingCurrentProduct = !currentFamily;
      if (!addingCurrentProduct && selectedProducts.length === 0) {
        throw new Error("Select at least one product to add");
      }

      return api.post(`/storefront/product-families/${familyId}/items`, {
        items: [
          ...(addingCurrentProduct ? [{
            productId: product.id,
            variantLabel: variantLabel.trim() || product.name,
            isDefault: makeDefault,
          }] : []),
          ...selectedProducts.map((candidate) => ({
            productId: candidate.id,
            variantLabel: candidate.suggestedVariantLabel ?? candidate.size ?? candidate.name,
          })),
        ],
      });
    },
    onSuccess: async () => {
      setNotice(currentFamily ? "Products added to the variant group." : "Product linked to the selected variant group.");
      setSelectedAdditionalProductIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familiesQueryKey }),
        onUpdated(),
      ]);
    },
    onError: (mutationError) => setError(readErrorMessage(mutationError)),
  });

  const saveFamily = useMutation({
    mutationFn: async () => {
      if (!currentFamily || !currentItem) {
        throw new Error("This product is not in a variant group");
      }

      return api.patch(`/storefront/product-families/${currentFamily.id}`, {
        name: familyName.trim() || currentFamily.name,
        attributeLabel: attributeLabel.trim() || currentFamily.attributeLabel,
        items: currentFamily.items.map((item) => ({
          id: item.id,
          variantLabel: item.id === currentItem.id ? variantLabel.trim() || item.variantLabel : item.variantLabel,
          sortOrder: item.sortOrder,
          isDefault: item.id === currentItem.id ? makeDefault : makeDefault ? false : item.isDefault,
        })),
      });
    },
    onSuccess: async () => {
      setNotice("Variant group updated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familiesQueryKey }),
        onUpdated(),
      ]);
    },
    onError: (mutationError) => setError(readErrorMessage(mutationError)),
  });

  const removeFromFamily = useMutation({
    mutationFn: async () => {
      if (!currentFamily || !currentItem) {
        throw new Error("This product is not in a variant group");
      }

      return api.delete<{ archived?: boolean }>(`/storefront/product-families/${currentFamily.id}/items/${currentItem.id}`);
    },
    onSuccess: async (result: { archived?: boolean }) => {
      setNotice(result.archived ? "Variant group archived because fewer than two products remained." : "Product removed from the variant group.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: familiesQueryKey }),
        onUpdated(),
      ]);
      onClose();
    },
    onError: (mutationError) => setError(readErrorMessage(mutationError)),
  });

  const busy = createSuggestedFamily.isPending || createManualFamily.isPending || addProductsToFamily.isPending || saveFamily.isPending || removeFromFamily.isPending;

  function toggleAdditionalProduct(productId: string) {
    setSelectedAdditionalProductIds((current) =>
      current.includes(productId)
        ? current.filter((value) => value !== productId)
        : [...current, productId]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-md border border-border bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Boxes className="size-4 text-blue-700" aria-hidden="true" />
              Ecommerce variant group
            </div>
            <div className="mt-1 text-sm text-slate-500">{product.name}</div>
          </div>
          <button type="button" className="inline-flex size-9 items-center justify-center rounded-md border border-border text-slate-600" onClick={onClose} aria-label="Close variant group manager">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div> : null}
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          {familiesQuery.isLoading ? <div className="rounded-md border border-border bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">Loading variant groups...</div> : null}
          {familiesQuery.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{familiesQuery.error.message}</div> : null}

          {!familiesQuery.isLoading && !familiesQuery.error ? (
            <>
              <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-md border border-border bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-950">Current product setup</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {currentFamily
                      ? `This product is currently part of ${currentFamily.name}.`
                      : "This product is not grouped yet. You can create a new ecommerce variant family or link it to an existing one."}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Family name
                      <input value={familyName} onChange={(event) => setFamilyName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" placeholder="Groundnut Oil" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      Variant label
                      <input value={attributeLabel} onChange={(event) => setAttributeLabel(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" placeholder="Size" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">
                      This product option
                      <input value={variantLabel} onChange={(event) => setVariantLabel(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" placeholder="1L" />
                    </label>
                    <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-slate-700 md:mt-6">
                      <input className="size-4 accent-emerald-600" type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
                      Make this the default variant
                    </label>
                  </div>
                  {currentFamily ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy} onClick={() => saveFamily.mutate()}>
                        {saveFamily.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Save group
                      </button>
                      <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 disabled:opacity-60" disabled={busy} onClick={() => removeFromFamily.mutate()}>
                        <Trash2 className="size-4" />
                        Remove from group
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {matchingSuggestion ? (
                        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 bg-white px-4 text-sm font-semibold text-emerald-700 disabled:opacity-60" disabled={busy} onClick={() => createSuggestedFamily.mutate()}>
                          {createSuggestedFamily.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                          Use suggestion
                        </button>
                      ) : null}
                      <div className="flex min-w-[240px] flex-1 items-end gap-2">
                        <label className="block min-w-0 flex-1 text-sm font-medium text-slate-700">
                          Link to existing group
                          <select value={targetFamilyId} onChange={(event) => setTargetFamilyId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600">
                            <option value="">Choose group</option>
                            {(familyData?.families ?? []).map((family) => (
                              <option key={family.id} value={family.id}>{family.name}</option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 disabled:opacity-60" disabled={busy || !targetFamilyId} onClick={() => addProductsToFamily.mutate(targetFamilyId)}>
                          {addProductsToFamily.isPending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                          Link
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-border bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-950">Group preview</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {currentFamily
                      ? `${String(currentFamily.items.length)} products are in this group.`
                      : matchingSuggestion
                        ? `Suggested family ${matchingSuggestion.name} includes ${String(matchingSuggestion.items.length)} products.`
                        : "No existing family yet. Create one from this screen."}
                  </div>
                  <div className="mt-4 space-y-2">
                    {(currentFamily?.items ?? matchingSuggestion?.items ?? []).map((item) => (
                      <div key={`preview-${item.productId}`} className={`rounded-md border px-3 py-2 text-sm ${item.productId === product.id ? "border-emerald-200 bg-emerald-50" : "border-border bg-white"}`}>
                        <div className="font-medium text-slate-950">{item.productName}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.variantLabel} | Stock {item.currentStock}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-border bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">
                      {currentFamily ? "Add more products to this group" : "Pick the other products for this group"}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      Select separate POS products that should appear as variant options on the ecommerce product page.
                    </div>
                  </div>
                  <div className="text-sm text-slate-500">{selectedAdditionalProductIds.length} selected</div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                  <label className="block text-sm font-medium text-slate-700">
                    Search products
                    <input value={familySearch} onChange={(event) => setFamilySearch(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" placeholder="Search by name, SKU, barcode, brand" />
                  </label>
                  <div className="flex items-end gap-2">
                    {currentFamily ? (
                      <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || selectedAdditionalProductIds.length === 0} onClick={() => addProductsToFamily.mutate(currentFamily.id)}>
                        {addProductsToFamily.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        Add selected
                      </button>
                    ) : (
                      <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || selectedAdditionalProductIds.length === 0 || !familyName.trim()} onClick={() => createManualFamily.mutate()}>
                        {createManualFamily.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        Create group
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-4 max-h-[320px] overflow-y-auto rounded-md border border-border bg-white">
                  {filteredUngroupedProducts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-slate-500">No matching ungrouped products found.</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {filteredUngroupedProducts.slice(0, 100).map((candidate) => (
                        <label key={candidate.id} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                          <div className="flex min-w-0 items-center gap-3">
                            <input className="size-4 accent-emerald-600" type="checkbox" checked={selectedAdditionalProductIds.includes(candidate.id)} onChange={() => toggleAdditionalProduct(candidate.id)} />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-950">{candidate.name}</div>
                              <div className="mt-1 text-xs text-slate-500">{[candidate.brand, candidate.categoryName, candidate.suggestedVariantLabel ?? candidate.size].filter(Boolean).join(" | ")}</div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-semibold text-slate-950">{formatCurrency(candidate.sellingPrice)}</div>
                            <div className="text-xs text-slate-500">{candidate.currentStock} in stock</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function stockCountStatusClass(status: string): string {
  if (status === "OPEN") {
    return "bg-blue-50 text-blue-700";
  }

  if (status === "SUBMITTED") {
    return "bg-amber-50 text-amber-800";
  }

  if (status === "APPROVED") {
    return "bg-emerald-50 text-emerald-700";
  }

  return "bg-slate-100 text-slate-600";
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatCurrency(value: number | string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function stripSizeSuffix(value: string): string {
  return value.replace(/\s*\d+(?:\.\d+)?\s?(ml|l|ltr|litre|litres|g|gm|kg|kgs)\b/gi, "").replace(/\s{2,}/g, " ").trim() || value;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function StockAdjustment({ onSaved }: Readonly<{ onSaved: () => void }>) {
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductRecord | null>(null);
  const [direction, setDirection] = useState<"ADD" | "REMOVE">("ADD");
  const [reason, setReason] = useState("");
  const searchTerm = productSearch.trim();
  const productsQuery = useQuery({
    queryKey: ["products", "stock-adjustment", searchTerm],
    queryFn: () => listProducts({ limit: 20, ...(searchTerm ? { search: searchTerm } : {}) }),
    enabled: searchTerm.length > 0,
  });
  const mutation = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/inventory/stock-adjustment", payload),
    onSuccess: () => {
      setSelectedProduct(null);
      setProductSearch("");
      setDirection("ADD");
      setReason("");
      onSaved();
    },
  });
  const products = productsQuery.data?.data ?? [];

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const quantity = Math.abs(Number(form.get("quantity")));
    const notes = reason === "OTHER"
      ? formString(form, "otherReason") || formString(form, "notes") || undefined
      : formString(form, "notes") || undefined;
    mutation.mutate({
      productId: selectedProduct.id,
      direction,
      quantity,
      reason,
      ...(notes ? { notes } : {}),
    });
  }

  return (
    <section className="rounded-md border border-border bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-950">Stock adjustment</div>
      {mutation.error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mutation.error.message}</div> : null}
      <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
        <label className="relative block text-sm font-medium text-slate-700 md:col-span-2">
          Product
          <input
            value={productSearch}
            onChange={(event) => {
              setProductSearch(event.target.value);
              setSelectedProduct(null);
            }}
            placeholder="Search product name, Product ID, or barcode"
            className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm"
          />
          {selectedProduct ? (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Selected: {selectedProduct.name} | Stock {Number(selectedProduct.currentStock)}
            </div>
          ) : searchTerm ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-white shadow-lg">
              {productsQuery.isLoading ? <div className="px-3 py-2 text-sm text-slate-500">Searching products...</div> : null}
              {!productsQuery.isLoading && products.length === 0 ? <div className="px-3 py-2 text-sm text-slate-500">No products found.</div> : null}
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-emerald-50"
                  onClick={() => {
                    setSelectedProduct(product);
                    setProductSearch(product.name);
                  }}
                >
                  <span className="font-medium text-slate-950">{product.name}</span>
                  <span className="ml-2 text-xs text-slate-500">Stock {Number(product.currentStock)}{product.sku ? ` | SKU ${product.sku}` : ""}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value === "REMOVE" ? "REMOVE" : "ADD")} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
            <option value="ADD">Stock in (+)</option>
            <option value="REMOVE">Stock out (-)</option>
          </select>
        </label>
        <TextInput name="quantity" label="Quantity" type="number" required />
        <label className="block text-sm font-medium text-slate-700">
          Reason
          <select name="reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" required>
            <option value="">Select reason</option>
            <option value="OPENING_STOCK">Opening stock</option>
            <option value="GOODS_RECEIVED">Goods received</option>
            <option value="DAMAGE">Damage</option>
            <option value="THEFT">Theft</option>
            <option value="EXPIRY_WRITE_OFF">Expiry write-off</option>
            <option value="MANUAL_CORRECTION">Manual correction</option>
            <option value="STOCK_COUNT">Stock count</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        {reason === "OTHER" ? <TextInput name="otherReason" label="Other - specify" required /> : null}
        <TextInput name="notes" label="Notes" />
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2" disabled={mutation.isPending || !selectedProduct}>
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
