"use client";

import { useEffect, useState } from "react";

import { getStoredTenant, getStoredVerticalConfig, type StoredTenant } from "@/lib/vertical-config";
import type { VerticalConfig } from "@retailos/shared";

export function SettingsPanel() {
  const [tenant, setTenant] = useState<StoredTenant | null>(null);
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig | null>(null);

  useEffect(() => {
    setTenant(getStoredTenant());
    setVerticalConfig(getStoredVerticalConfig());
  }, []);

  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="text-sm font-semibold text-slate-950">{tenant?.name ?? "Shop"}</div>
      <div className="mt-1 text-sm text-slate-500">{verticalConfig?.displayName ?? "Retail"} | GST enabled | INR</div>
    </div>
  );
}
