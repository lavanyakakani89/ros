import { CustomersClient } from "@/components/customers/customers-client";
import { PageHeader } from "@/components/shared/page-header";

export default function CustomersPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Customers" title="Customer accounts" />
      <CustomersClient />
    </div>
  );
}
