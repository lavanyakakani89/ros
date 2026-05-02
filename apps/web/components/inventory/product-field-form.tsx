"use client";

import type { VerticalConfig, VerticalField } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getStoredVerticalConfig } from "@/lib/vertical-config";

export function ProductFieldForm() {
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig>(pharmacyConfig);

  useEffect(() => {
    const storedConfig = getStoredVerticalConfig();
    if (storedConfig) {
      setVerticalConfig(storedConfig);
    }
  }, []);

  const groupedFields = useMemo(() => {
    const base = verticalConfig.productFields.filter((field) => !field.vertical);
    const vertical = verticalConfig.productFields.filter((field) => field.vertical);
    return { base, vertical };
  }, [verticalConfig.productFields]);

  return (
    <section className="rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">Product entry</div>
          <div className="text-xs text-slate-500">{verticalConfig.displayName}</div>
        </div>
        <button className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white">
          <Save className="size-4" aria-hidden="true" />
          Save
        </button>
      </div>
      <form className="grid gap-4 p-4 lg:grid-cols-2">
        {groupedFields.base.map((field) => (
          <DynamicField key={field.key} field={field} />
        ))}
        {groupedFields.vertical.length > 0 ? (
          <div className="border-t border-border pt-4 lg:col-span-2">
            <div className="mb-3 text-xs font-semibold uppercase text-slate-500">{verticalConfig.displayName} fields</div>
            <div className="grid gap-4 lg:grid-cols-2">
              {groupedFields.vertical.map((field) => (
                <DynamicField key={field.key} field={field} />
              ))}
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function DynamicField({ field }: Readonly<{ field: VerticalField }>) {
  const commonClass = "mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600";

  return (
    <label className="block text-sm font-medium text-slate-700">
      <span className="flex items-center gap-1">
        {field.label}
        {field.required ? <span className="text-emerald-700">*</span> : null}
      </span>
      {field.type === "select" ? (
        <select className={commonClass} defaultValue="">
          <option value="" disabled>Select</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : null}
      {field.type === "boolean" ? (
        <div className="mt-2 flex h-10 items-center gap-2 rounded-md border border-border px-3">
          <input type="checkbox" className="size-4 accent-emerald-600" />
          <span className="text-sm text-slate-600">Enabled</span>
        </div>
      ) : null}
      {field.type !== "select" && field.type !== "boolean" ? (
        <input className={commonClass} type={inputTypeFor(field.type)} inputMode={inputModeFor(field.type)} />
      ) : null}
    </label>
  );
}

function inputTypeFor(type: VerticalField["type"]): string {
  if (type === "date") {
    return "date";
  }

  if (type === "number" || type === "decimal") {
    return "number";
  }

  return "text";
}

function inputModeFor(type: VerticalField["type"]): "text" | "decimal" | "numeric" | undefined {
  if (type === "decimal") {
    return "decimal";
  }

  if (type === "number") {
    return "numeric";
  }

  return undefined;
}
