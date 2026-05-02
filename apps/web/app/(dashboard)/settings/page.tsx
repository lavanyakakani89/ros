import { SettingsPanel } from "@/components/settings/settings-panel";
import { PageHeader } from "@/components/shared/page-header";

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title="Shop settings" />
      <SettingsPanel />
    </div>
  );
}
