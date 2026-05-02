import { PageHeader } from "@/components/shared/page-header";
import { StatStrip } from "@/components/shared/stat-strip";

export default function PaymentsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Payments" title="Collections" />
      <StatStrip items={[{ label: "Cash", value: "₹9,840", tone: "slate" }, { label: "UPI", value: "₹6,230", tone: "emerald" }, { label: "Card", value: "₹2,350", tone: "blue" }, { label: "Credit due", value: "₹4,120", tone: "amber" }]} />
      <div className="rounded-md border border-border bg-white p-4 text-sm text-slate-600">Recent payments will appear here.</div>
    </div>
  );
}
