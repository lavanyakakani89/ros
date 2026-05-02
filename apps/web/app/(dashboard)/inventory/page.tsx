import { Plus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatStrip } from "@/components/shared/stat-strip";
import { ProductFieldForm } from "@/components/inventory/product-field-form";

const products = ["Paracetamol 500", "Amoxicillin 250", "ORS sachet", "Digital thermometer"];

export default function InventoryPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Inventory"
        title="Products and batches"
        actions={<button className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white"><Plus className="size-4" aria-hidden="true" />New product</button>}
      />
      <StatStrip items={[{ label: "Active products", value: "1,248", tone: "blue" }, { label: "Low stock", value: "42", tone: "amber" }, { label: "Expiring soon", value: "18", tone: "emerald" }, { label: "Stock value", value: "₹8.4L", tone: "slate" }]} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <ProductFieldForm />
        <div className="rounded-md border border-border bg-white">
          {products.map((product) => (
            <div key={product} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
              <div>
                <div className="text-sm font-medium text-slate-950">{product}</div>
                <div className="text-xs text-slate-500">GST mapped • batch tracked</div>
              </div>
              <div className="text-right text-sm font-semibold text-slate-900">In stock</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
