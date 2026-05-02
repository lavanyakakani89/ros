import { PageHeader } from "@/components/shared/page-header";

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title="Shop settings" />
      <div className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-950">Demo Pharmacy</div>
        <div className="mt-1 text-sm text-slate-500">Pharmacy vertical • GST enabled • INR</div>
      </div>
    </div>
  );
}
