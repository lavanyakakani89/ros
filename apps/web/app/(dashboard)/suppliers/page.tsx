import { PageHeader } from "@/components/shared/page-header";
import { SuppliersClient } from "@/components/suppliers/suppliers-client";

export default function SuppliersPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Suppliers" title="Supplier management" />
      <SuppliersClient />
    </div>
  );
}
