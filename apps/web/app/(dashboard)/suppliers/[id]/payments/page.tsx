import { SupplierPayments } from "@/components/suppliers/supplier-payments";
export const metadata = { title: "Supplier Payments — RetailOS" };
export default function SupplierPaymentsPage({ params }: { params: { id: string } }) {
  return <SupplierPayments supplierId={params.id} />;
}
