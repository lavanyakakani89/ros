import { CustomerLedger } from "@/components/customers/customer-ledger";
export const metadata = { title: "Customer Ledger — RetailOS" };
export default function CustomerLedgerPage({ params }: { params: { id: string } }) {
  return <CustomerLedger customerId={params.id} />;
}
