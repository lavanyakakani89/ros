import { PageHeader } from "@/components/shared/page-header";
import { StatStrip } from "@/components/shared/stat-strip";
import { ReportsDashboard } from "@/components/reports/reports-dashboard";

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Reports" title="Daily summary" />
      <StatStrip items={[{ label: "Gross sales", value: "₹18,420", tone: "emerald" }, { label: "GST collected", value: "₹1,972", tone: "blue" }, { label: "Invoices", value: "86", tone: "slate" }, { label: "Returns", value: "₹0", tone: "amber" }]} />
      <ReportsDashboard />
    </div>
  );
}
