import { PageHeader } from "@/components/shared/page-header";
import { LabelsClient } from "@/components/labels/labels-client";

export default function LabelsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Stock" title="Label printing" />
      <LabelsClient />
    </div>
  );
}
