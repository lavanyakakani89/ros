import { InventoryClient } from "@/components/inventory/inventory-client";
import { PageHeader } from "@/components/shared/page-header";

export default function InventoryPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Inventory" title="Products and batches" />
      <InventoryClient />
    </div>
  );
}
