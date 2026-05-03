import { PurchasesClient } from "@/components/purchases/purchases-client";
import { PageHeader } from "@/components/shared/page-header";

export default function PurchasesPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Purchases" title="Purchase orders" />
      <PurchasesClient />
    </div>
  );
}
