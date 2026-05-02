"use client";

import { useQuery } from "@tanstack/react-query";

import { ProductFieldForm } from "@/components/inventory/product-field-form";
import { StatStrip } from "@/components/shared/stat-strip";
import { listProducts, type ProductRecord } from "@/lib/api-client";

export function InventoryClient() {
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: listProducts,
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
          { label: "Expiring soon", value: "0", tone: "emerald" },
          { label: "Stock value", value: `INR ${stockValue.toFixed(2)}`, tone: "slate" },
        ]}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ProductFieldForm onCreated={() => void productsQuery.refetch()} />
        <ProductList products={products} loading={productsQuery.isLoading} error={productsQuery.error} />
      </div>
    </>
  );
}

function ProductList({ products, loading, error }: Readonly<{ products: ProductRecord[]; loading: boolean; error: Error | null }>) {
  if (loading) {
    return <div className="rounded-md border border-border bg-white p-4 text-sm text-slate-500">Loading products</div>;
  }

  if (error) {
    return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</div>;
  }

  return (
    <div className="rounded-md border border-border bg-white">
      {products.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">No products yet. Add your first item from the form.</div>
      ) : (
        products.map((product) => (
          <div key={product.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
            <div>
              <div className="text-sm font-medium text-slate-950">{product.name}</div>
              <div className="text-xs text-slate-500">{product.unit} | GST {product.gstRate}%{product.sku ? ` | SKU ${product.sku}` : ""}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-900">{Number(product.currentStock).toString()}</div>
              <div className="text-xs text-slate-500">INR {Number(product.sellingPrice).toFixed(2)}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
