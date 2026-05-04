import { TemplateSettings } from "@/components/settings/template-settings";
import { PageHeader } from "@/components/shared/page-header";

export default function TemplatesPage() {
  return (
    <>
      <PageHeader eyebrow="Settings" title="Invoice templates" />
      <TemplateSettings />
    </>
  );
}
