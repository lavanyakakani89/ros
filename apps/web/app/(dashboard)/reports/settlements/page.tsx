import { SettlementsReport } from "@/components/reports/settlements-report";
import { PageHeader } from "@/components/shared/page-header";

export default function SettlementsReportPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Reports" title="Partner settlements" subtitle="Generate draft settlements, review them, and lock settled history." />
      <SettlementsReport />
    </div>
  );
}
