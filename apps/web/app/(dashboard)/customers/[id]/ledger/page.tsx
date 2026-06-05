import { CustomerLedger } from "@/components/customers/customer-ledger";
export const metadata = { title: "Customer Ledger — BizBil" };
export default function CustomerLedgerPage({ params }: { params: { id: string } }) {
  return <CustomerLedger customerId={params.id} />;
}
