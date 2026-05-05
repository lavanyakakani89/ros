"use client";

import type { VerticalConfig, VerticalField } from "@retailos/shared";
import { pharmacyConfig } from "@retailos/vertical-configs";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createProduct, type ProductPayload } from "@/lib/api-client";
import { getStoredTenant, getStoredVerticalConfig } from "@/lib/vertical-config";

export function ProductFieldForm({ onCreated }: Readonly<{ onCreated?: () => void }>) {
  const [verticalConfig, setVerticalConfig] = useState<VerticalConfig>(pharmacyConfig);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gstEnabled, setGstEnabled] = useState(true);

  useEffect(() => {
    const storedConfig = getStoredVerticalConfig();
    if (storedConfig) {
      setVerticalConfig(storedConfig);
    }
    setGstEnabled(getStoredTenant()?.gstEnabled ?? true);
  }, []);

  const activeProductFields = useMemo(
    () => withImportExportFields(verticalConfig.productFields).filter((field) => gstEnabled || !["gstRate", "hsnCode", "cessRate"].includes(field.key)),
    [gstEnabled, verticalConfig.productFields],
  );

  const groupedFields = useMemo(() => {
    const fieldByKey = new Map(activeProductFields.map((field) => [field.key, field]));
    const required = requiredProductFieldKeys.map((key) => fieldByKey.get(key)).filter((field): field is VerticalField => Boolean(field));
    const requiredKeys = new Set(required.map((field) => field.key));
    const optional = activeProductFields.filter((field) => !requiredKeys.has(field.key));
    return { required, optional };
  }, [activeProductFields]);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus(null);
    setError(null);
    setSaving(true);

    const form = new FormData(formElement);

    try {
      await createProduct(toProductPayload(form, activeProductFields, gstEnabled));
      formElement.reset();
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
          {groupedFields.required.map((field) => (
            <DynamicField key={field.key} field={field} />
          ))}
          {groupedFields.optional.length > 0 ? (
            <details className="rounded-md border border-border bg-slate-50 lg:col-span-2">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700">
                Additional details
                <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
              </summary>
              <div className="border-t border-border bg-white px-3 py-3 text-xs font-semibold uppercase text-slate-500">{verticalConfig.displayName} optional fields</div>
              <div className="grid gap-4 bg-white p-3 lg:grid-cols-2">
                {groupedFields.optional.map((field) => (
                  <DynamicField key={field.key} field={field} />
                ))}
              </div>
            </details>
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

function toProductPayload(form: FormData, fields: readonly VerticalField[], gstEnabled: boolean): ProductPayload {
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

  const salesUnit = requireString(payload.salesUnit, "Sales unit is required");
  const mrp = requireNumber(payload.mrp, "MRP is required");
  const sellingPrice = requireNumber(payload.sellingPrice, "Retail sale price is required");
  const category = payload.verticalData?.category;
    if (typeof category !== "string" || category.trim() === "") {
    throw new Error("Category is required");
  }
  const subCategoryId = requireString(payload.legacySubCategoryId, "Sub category ID is required");

  return {
    name: requireString(payload.name, "Product name is required"),
    unit: payload.unit ? requireString(payload.unit, "Unit is required") : salesUnit,
    mrp,
    sellingPrice,
    gstRate: gstEnabled && payload.gstRate !== undefined ? requireNumber(payload.gstRate, "GST rate is required") : 0,
    currentStock: payload.currentStock ?? 0,
    sku: requireString(payload.sku, "Product ID is required"),
    barcode: requireString(payload.barcode, "Barcode is required"),
    ...(payload.description ? { description: payload.description } : {}),
    ...(payload.partGroup ? { partGroup: payload.partGroup } : {}),
    legacySubCategoryId: subCategoryId,
    categoryId: subCategoryId,
    ...(payload.purchasePrice !== undefined ? { purchasePrice: payload.purchasePrice } : {}),
    ...(payload.wholesalePrice !== undefined ? { wholesalePrice: payload.wholesalePrice } : {}),
    ...(payload.defaultDiscountPercent !== undefined ? { defaultDiscountPercent: payload.defaultDiscountPercent } : {}),
    ...(payload.cessRate !== undefined ? { cessRate: payload.cessRate } : {}),
    ...(payload.hsnCode ? { hsnCode: payload.hsnCode } : {}),
    ...(payload.reorderLevel !== undefined ? { reorderLevel: payload.reorderLevel } : {}),
    ...(payload.purchaseUnit ? { purchaseUnit: payload.purchaseUnit } : {}),
    salesUnit,
    ...(payload.alternateUnit ? { alternateUnit: payload.alternateUnit } : {}),
    ...(payload.conversionValue !== undefined ? { conversionValue: payload.conversionValue } : {}),
    ...(payload.godown ? { godown: payload.godown } : {}),
    ...(payload.rack ? { rack: payload.rack } : {}),
    ...(payload.defaultSaleQty !== undefined ? { defaultSaleQty: payload.defaultSaleQty } : {}),
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

  return typeof value === "string" ? value : value.name;
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
  description: true,
  partGroup: true,
  legacySubCategoryId: true,
  categoryId: true,
  unit: true,
  mrp: true,
  sellingPrice: true,
  purchasePrice: true,
  wholesalePrice: true,
  defaultDiscountPercent: true,
  gstRate: true,
  cessRate: true,
  hsnCode: true,
  currentStock: true,
  reorderLevel: true,
  purchaseUnit: true,
  salesUnit: true,
  alternateUnit: true,
  conversionValue: true,
  godown: true,
  rack: true,
  defaultSaleQty: true,
  verticalData: true,
};

const requiredProductFieldKeys = [
  "sku",
  "name",
  "legacySubCategoryId",
  "salesUnit",
  "mrp",
  "sellingPrice",
  "barcode",
  "verticalData.category",
];

const importExportFields: readonly VerticalField[] = [
  { key: "verticalData.category", label: "Category", type: "text", required: true, vertical: true },
  { key: "description", label: "Description", type: "text", required: false },
  { key: "legacySubCategoryId", label: "Sub category ID", type: "text", required: true },
  { key: "partGroup", label: "Part / group", type: "text", required: false },
  { key: "wholesalePrice", label: "Wholesale price (₹)", type: "decimal", required: false },
  { key: "defaultDiscountPercent", label: "Discount %", type: "decimal", required: false },
  { key: "cessRate", label: "CESS %", type: "decimal", required: false },
  { key: "currentStock", label: "Opening qty", type: "decimal", required: false },
  { key: "purchaseUnit", label: "Purchase unit", type: "text", required: false },
  { key: "salesUnit", label: "Sales unit", type: "text", required: true },
  { key: "alternateUnit", label: "Alter unit", type: "text", required: false },
  { key: "conversionValue", label: "Conversion value", type: "decimal", required: false },
  { key: "godown", label: "Godown", type: "text", required: false },
  { key: "rack", label: "Rack", type: "text", required: false },
  { key: "defaultSaleQty", label: "Default sale qty", type: "decimal", required: false },
];

function withImportExportFields(fields: readonly VerticalField[]): readonly VerticalField[] {
  const keys = new Set(fields.map((field) => field.key));
  return [...fields, ...importExportFields.filter((field) => !keys.has(field.key))]
    .map(normalizeProductField)
    .filter((field, index, allFields) => allFields.findIndex((candidate) => candidate.key === field.key) === index);
}

function normalizeProductField(field: VerticalField): VerticalField {
  const overrides: Record<string, Partial<VerticalField>> = {
    sku: { label: "Product ID", required: true },
    name: { label: "Product name", required: true },
    barcode: { label: "Barcode", required: true },
    legacySubCategoryId: { label: "Sub category ID", required: true },
    salesUnit: { label: "Sales unit", required: true },
    mrp: { label: "MRP", required: true },
    unit: { label: "Base unit", required: false },
    sellingPrice: { label: "Retail Sale Price", required: true },
    gstRate: { required: false },
    "verticalData.category": { label: "Category", required: true, vertical: true },
  };

  return {
    ...field,
    ...overrides[field.key],
  };
}

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
