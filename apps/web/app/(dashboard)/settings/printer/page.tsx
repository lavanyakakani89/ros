import { PrinterSettings } from "@/components/settings/printer-settings";
import { PageHeader } from "@/components/shared/page-header";

export default function PrinterPage() {
  return (
    <>
      <PageHeader eyebrow="Settings" title="Printer setup" />
      <PrinterSettings />
    </>
  );
}
