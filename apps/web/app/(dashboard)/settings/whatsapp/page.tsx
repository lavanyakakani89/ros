import { WhatsappSettings } from "@/components/settings/whatsapp-settings";
import { PageHeader } from "@/components/shared/page-header";

export default function WhatsappSettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Settings" title="WhatsApp Business" />
      <WhatsappSettings />
    </>
  );
}
