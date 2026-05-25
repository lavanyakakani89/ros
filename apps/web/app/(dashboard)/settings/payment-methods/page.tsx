import { PaymentMethodsSettings } from "@/components/settings/payment-methods-settings";
import { PageHeader } from "@/components/shared/page-header";

export default function PaymentMethodsSettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title="Payment methods" subtitle="Create, reorder, archive, and settle every payment rail used on the billing screen." />
      <PaymentMethodsSettings />
    </div>
  );
}
