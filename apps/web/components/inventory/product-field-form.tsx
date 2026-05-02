"use client";

import type { VerticalConfig, VerticalField } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createProduct, type ProductPayload } from "@/lib/api-client";
import { getStoredVerticalConfig } from "@/lib/vertical-config";

export function ProductFieldForm({ onCreated }: Readonly<{ onCreated?: () => void }>) {
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig>(pharmacyConfig);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setError(null);
    setSaving(true);

    const form = new FormData(event.currentTarget);

    try {
      await createProduct(toProductPayload(form, verticalConfig.productFields));
      event.currentTarget.reset();
      setStatus("Product saved.");
      onCreated?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save product");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-border bg-white">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">Product entry</div>
          <div className="text-xs text-slate-500">{verticalConfig.displayName}</div>
        </div>
        <button className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          {saving ? "Saving" : "Save"}
        </button>
        </div>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
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
        {status ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 lg:col-span-2">{status}</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 lg:col-span-2">{error}</div> : null}
      </div>
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
        <select name={field.key} className={commonClass} defaultValue="" required={field.required}>
          <option value="" disabled>Select</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : null}
      {field.type === "boolean" ? (
        <div className="mt-2 flex h-10 items-center gap-2 rounded-md border border-border px-3">
          <input name={field.key} type="checkbox" value="true" className="size-4 accent-emerald-600" />
          <span className="text-sm text-slate-600">Enabled</span>
        </div>
      ) : null}
      {field.type !== "select" && field.type !== "boolean" ? (
        <input name={field.key} className={commonClass} type={inputTypeFor(field.type)} inputMode={inputModeFor(field.type)} required={field.required} step={field.type === "decimal" ? "0.01" : undefined} />
      ) : null}
    </label>
  );
}

function toProductPayload(form: FormData, fields: readonly VerticalField[]): ProductPayload {
  const payload: Partial<ProductPayload> = {
    currentStock: 0,
  };
  const verticalData: Record<string, unknown> = {};

  for (const field of fields) {
    const value = field.type === "boolean" ? form.get(field.key) === "true" : form.get(field.key);

    if (value === null || value === "") {
      continue;
    }

    const normalizedValue = normalizeFieldValue(field, value);

    if (field.key.startsWith("verticalData.")) {
      verticalData[field.key.replace("verticalData.", "")] = normalizedValue;
      continue;
    }

    setProductValue(payload, field.key, normalizedValue);
  }

  if (Object.keys(verticalData).length > 0) {
    payload.verticalData = verticalData;
  }

  return {
    name: requireString(payload.name, "Product name is required"),
    unit: requireString(payload.unit, "Unit is required"),
    mrp: requireNumber(payload.mrp, "MRP is required"),
    sellingPrice: requireNumber(payload.sellingPrice, "Selling price is required"),
    gstRate: requireNumber(payload.gstRate, "GST rate is required"),
    currentStock: Number(payload.currentStock ?? 0),
    ...(payload.sku ? { sku: payload.sku } : {}),
    ...(payload.barcode ? { barcode: payload.barcode } : {}),
    ...(payload.purchasePrice !== undefined ? { purchasePrice: Number(payload.purchasePrice) } : {}),
    ...(payload.hsnCode ? { hsnCode: payload.hsnCode } : {}),
    ...(payload.reorderLevel !== undefined ? { reorderLevel: Number(payload.reorderLevel) } : {}),
    ...(payload.verticalData ? { verticalData: payload.verticalData } : {}),
  };
}

function normalizeFieldValue(field: VerticalField, value: FormDataEntryValue | boolean): string | number | boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (field.type === "number" || field.type === "decimal") {
    return Number(value);
  }

  return value.toString();
}

function setProductValue(payload: Partial<ProductPayload>, key: string, value: string | number | boolean): void {
  if (key in productKeys) {
    Object.assign(payload, { [key]: value });
  }
}

const productKeys: Record<keyof ProductPayload, true> = {
  name: true,
  sku: true,
  barcode: true,
  unit: true,
  mrp: true,
  sellingPrice: true,
  purchasePrice: true,
  gstRate: true,
  hsnCode: true,
  currentStock: true,
  reorderLevel: true,
  verticalData: true,
};

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }

  return value;
}

function requireNumber(value: unknown, message: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(message);
  }

  return number;
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
