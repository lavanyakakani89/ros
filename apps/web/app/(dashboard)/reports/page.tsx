import { ReportsDashboard } from "@/components/reports/reports-dashboard";
import { PageHeader } from "@/components/shared/page-header";

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Reports" title="Daily summary" />
      <ReportsDashboard />
    </div>
  );
}
