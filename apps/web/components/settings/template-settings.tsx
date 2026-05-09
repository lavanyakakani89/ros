"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Save, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

type PaperSize = "THERMAL_2" | "THERMAL_3" | "THERMAL_4" | "A5" | "A4";
type RenderType = "ESC_POS" | "HTML_PDF";

interface InvoiceTemplate {
  id: string;
  tenantId?: string | null;
  name: string;
  description?: string | null;
  paperSize: PaperSize;
  renderType: RenderType;
  htmlSource?: string | null;
  escposConfig?: unknown;
  uiConfig?: unknown;
  isSystem: boolean;
  isDefault: boolean;
  version: number;
}

interface TemplatesResponse {
  templates: InvoiceTemplate[];
  effectiveTemplateId?: string | null;
}

interface SetDefaultResponse {
  status: string;
  template: InvoiceTemplate;
}

interface PreviewResponse {
  renderType: RenderType;
  previewHtml?: string;
  previewText?: string;
}

export function TemplateSettings() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const templatesQuery = useQuery({
    queryKey: ["invoice-templates"],
    queryFn: () => createAuthenticatedApiClient().get<TemplatesResponse>("/templates"),
  });
  const selectedTemplate = useMemo(() => {
    const templates = templatesQuery.data?.templates ?? [];
    return (
      templates.find((template) => template.id === selectedId) ??
      templates.find((template) => template.id === templatesQuery.data?.effectiveTemplateId) ??
      templates[0] ??
      null
    );
  }, [selectedId, templatesQuery.data?.effectiveTemplateId, templatesQuery.data?.templates]);
  const tenantTemplates = templatesQuery.data?.templates.filter((template) => !template.isSystem) ?? [];
  const systemTemplates = templatesQuery.data?.templates.filter((template) => template.isSystem) ?? [];

  const cloneTemplate = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post<{ template: InvoiceTemplate }>(`/templates/clone/${id}`, {}),
    onSuccess: async (result) => {
      setSelectedId(result.template.id);
      setMessage("Template cloned for this shop.");
      await queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
    },
  });
  const updateTemplate = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/templates/${id}`, payload),
    onSuccess: async () => {
      setMessage("Template saved.");
      await queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
    },
  });
  const deleteTemplate = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/templates/${id}`),
    onSuccess: async () => {
      setSelectedId(null);
      setMessage("Template deleted.");
      await queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
    },
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post<SetDefaultResponse>(`/templates/${id}/set-default`, {}),
    onSuccess: async (result) => {
      setSelectedId(result.template.id);
      setMessage("Default template updated.");
      await queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
    },
  });
  const loadPreview = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().get<PreviewResponse>(`/templates/${id}/preview`),
    onSuccess: setPreview,
  });

  function saveSelected(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || selectedTemplate.isSystem) return;

    const form = new FormData(event.currentTarget);
    const renderType = formString(form, "renderType") as RenderType;
    updateTemplate.mutate({
      id: selectedTemplate.id,
      payload: {
        name: formString(form, "name"),
        description: formString(form, "description") || null,
        paperSize: formString(form, "paperSize"),
        renderType,
        htmlSource: formString(form, "htmlSource") || null,
        escposConfig: renderType === "ESC_POS" ? escposConfigFromForm(form, selectedTemplate.escposConfig) : parseJson(formString(form, "escposConfig")),
        uiConfig: parseJson(formString(form, "uiConfig")),
      },
    });
  }

  const error = templatesQuery.error ?? cloneTemplate.error ?? updateTemplate.error ?? deleteTemplate.error ?? setDefault.error ?? loadPreview.error;

  return (
    <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border p-4">
          <div className="text-sm font-semibold text-slate-950">System templates</div>
          <div className="text-xs text-slate-500">Clone one before editing.</div>
        </div>
        <div className="grid gap-2 p-3">
          {systemTemplates.map((template) => (
            <TemplateButton
              key={template.id}
              template={template}
              active={selectedTemplate?.id === template.id}
              effective={templatesQuery.data?.effectiveTemplateId === template.id}
              onSelect={() => setSelectedId(template.id)}
              action={
                <div className="flex flex-wrap gap-2">
                  <button className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs text-emerald-800" onClick={() => setDefault.mutate(template.id)}>
                    <Star className="size-3" aria-hidden="true" />
                    Use
                  </button>
                  <button className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs" onClick={() => cloneTemplate.mutate(template.id)}>
                    <Copy className="size-3" aria-hidden="true" />
                    Clone
                  </button>
                </div>
              }
            />
          ))}
        </div>
        <div className="border-y border-border p-4">
          <div className="text-sm font-semibold text-slate-950">Shop templates</div>
          <div className="text-xs text-slate-500">Editable templates for this shop.</div>
        </div>
        <div className="grid gap-2 p-3">
          {tenantTemplates.length === 0 ? <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">No shop templates yet.</div> : null}
          {tenantTemplates.map((template) => (
            <TemplateButton
              key={template.id}
              template={template}
              active={selectedTemplate?.id === template.id}
              effective={templatesQuery.data?.effectiveTemplateId === template.id}
              onSelect={() => setSelectedId(template.id)}
              action={
                <button className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs text-emerald-800" onClick={() => setDefault.mutate(template.id)}>
                  <Star className="size-3" aria-hidden="true" />
                  Use
                </button>
              }
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
        {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}
        {selectedTemplate ? (
          <form className="rounded-md border border-border bg-white p-4" onSubmit={saveSelected}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-950">{selectedTemplate.isSystem ? "System template preview" : "Edit shop template"}</div>
                <div className="text-xs text-slate-500">{selectedTemplate.paperSize} | {selectedTemplate.renderType} | v{selectedTemplate.version}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm" onClick={() => loadPreview.mutate(selectedTemplate.id)}>
                  <Eye className="size-4" aria-hidden="true" />
                  Preview
                </button>
                {!selectedTemplate.isSystem ? (
                  <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm text-red-700" onClick={() => deleteTemplate.mutate(selectedTemplate.id)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
            <fieldset className="grid gap-3 md:grid-cols-2" disabled={selectedTemplate.isSystem}>
              <TextInput name="name" label="Template name" defaultValue={selectedTemplate.name} />
              <TextInput name="description" label="Description" defaultValue={selectedTemplate.description ?? ""} />
              <SelectInput name="paperSize" label="Paper size" defaultValue={selectedTemplate.paperSize} options={["THERMAL_2", "THERMAL_3", "THERMAL_4", "A5", "A4"]} />
              <SelectInput name="renderType" label="Render type" defaultValue={selectedTemplate.renderType} options={["ESC_POS", "HTML_PDF"]} />
              {selectedTemplate.renderType === "ESC_POS" ? <EscposConfigEditor config={selectedTemplate.escposConfig} /> : <Textarea name="escposConfig" label="ESC/POS JSON" defaultValue={prettyJson(selectedTemplate.escposConfig)} />}
              <Textarea name="uiConfig" label="UI config JSON" defaultValue={prettyJson(selectedTemplate.uiConfig)} />
              <Textarea name="htmlSource" label="HTML/PDF template" defaultValue={selectedTemplate.htmlSource ?? ""} wide />
            </fieldset>
            {!selectedTemplate.isSystem ? (
              <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white" disabled={updateTemplate.isPending}>
                <Save className="size-4" aria-hidden="true" />
                Save template
              </button>
            ) : null}
          </form>
        ) : null}

        {preview ? (
          <section className="rounded-md border border-border bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-950">Preview</div>
            {preview.previewText ? <pre className="overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">{preview.previewText}</pre> : null}
            {preview.previewHtml ? <iframe className="h-[520px] w-full rounded-md border border-border" srcDoc={preview.previewHtml} title="Template preview" /> : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}

function TemplateButton({ template, active, effective, action, onSelect }: Readonly<{ template: InvoiceTemplate; active: boolean; effective: boolean; action: React.ReactNode; onSelect: () => void }>) {
  return (
    <div className={`rounded-md border p-3 ${active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <button className="w-full text-left" onClick={onSelect}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-950">{template.name}</span>
          {effective ? <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">Active</span> : null}
        </div>
        <div className="mt-1 text-xs text-slate-500">{template.paperSize} | {template.renderType}</div>
      </button>
      <div className="mt-3">{action}</div>
    </div>
  );
}

function TextInput({ name, label, defaultValue }: Readonly<{ name: string; label: string; defaultValue: string }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} defaultValue={defaultValue} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600" />
    </label>
  );
}

function SelectInput({ name, label, defaultValue, options }: Readonly<{ name: string; label: string; defaultValue: string; options: string[] }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select name={name} defaultValue={defaultValue} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Textarea({ name, label, defaultValue, wide }: Readonly<{ name: string; label: string; defaultValue: string; wide?: boolean }>) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${wide ? "md:col-span-2" : ""}`}>
      {label}
      <textarea name={name} defaultValue={defaultValue} rows={wide ? 10 : 6} className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-xs outline-none focus:border-emerald-600" />
    </label>
  );
}

function EscposConfigEditor({ config }: Readonly<{ config: unknown }>) {
  const values = readEscposConfig(config);

  return (
    <div className="grid gap-3 rounded-md border border-emerald-100 bg-emerald-50/40 p-3 md:col-span-2 md:grid-cols-3">
      <div className="md:col-span-3 text-sm font-semibold text-emerald-950">Thermal receipt controls</div>
      <SelectInput name="escposLayout" label="Receipt layout" defaultValue={values.layout} options={["STANDARD", "SIVSAN_DETAILED_3IN"]} />
      <NumberInput name="escposColumns" label="Columns" defaultValue={values.columns} min={24} max={64} />
      <NumberInput name="escposFeedLinesBeforeCut" label="Feed before cut" defaultValue={values.feedLinesBeforeCut} min={0} max={12} />
      <TextInput name="escposAlternatePhone" label="Alternate phone" defaultValue={values.alternatePhone} />
      <TextInput name="escposFssaiNumber" label="FSSAI number" defaultValue={values.fssaiNumber} />
      <TextInput name="escposCurrencyLabel" label="Currency label" defaultValue={values.currencyLabel} />
      <TextInput name="escposLogoText" label="Logo text" defaultValue={values.logoText} />
      <TextInput name="escposNote" label="Receipt note" defaultValue={values.note} />
      <TextInput name="escposFooterMessage" label="Footer message" defaultValue={values.footerMessage} />
      <div className="md:col-span-3 border-t border-emerald-100 pt-3 text-sm font-semibold text-emerald-950">Detailed receipt spacing</div>
      <NumberInput name="escposHeaderBlankLines" label="Header blank lines" defaultValue={values.spacing.headerBlankLines} min={0} max={5} />
      <NumberInput name="escposItemSerialWidth" label="SR width" defaultValue={values.spacing.itemSerialWidth} min={3} max={10} />
      <NumberInput name="escposItemNameWidth" label="Item width" defaultValue={values.spacing.itemNameWidth} min={8} max={40} />
      <NumberInput name="escposItemQtyWidth" label="Qty width" defaultValue={values.spacing.itemQtyWidth} min={5} max={12} />
      <NumberInput name="escposItemPriceWidth" label="Price width" defaultValue={values.spacing.itemPriceWidth} min={5} max={12} />
      <NumberInput name="escposItemAmountWidth" label="Amount width" defaultValue={values.spacing.itemAmountWidth} min={6} max={14} />
      <NumberInput name="escposLineGapBetweenItems" label="Blank lines between items" defaultValue={values.spacing.lineGapBetweenItems} min={0} max={3} />
      <NumberInput name="escposSummaryItemWidth" label="Summary item width" defaultValue={values.spacing.summaryItemWidth} min={8} max={24} />
      <NumberInput name="escposSummaryQtyWidth" label="Summary qty width" defaultValue={values.spacing.summaryQtyWidth} min={8} max={20} />
      <NumberInput name="escposSummaryAmountLabelWidth" label="Summary label width" defaultValue={values.spacing.summaryAmountLabelWidth} min={7} max={16} />
      <NumberInput name="escposSummaryAmountWidth" label="Summary amount width" defaultValue={values.spacing.summaryAmountWidth} min={7} max={16} />
      <NumberInput name="escposBeforeFooterBlankLines" label="Before footer blank lines" defaultValue={values.spacing.beforeFooterBlankLines} min={0} max={5} />
      <div className="md:col-span-3 border-t border-emerald-100 pt-3 text-sm font-semibold text-emerald-950">Visible fields</div>
      <CheckboxInput name="escposCut" label="Auto cut paper" defaultChecked={values.cut} />
      <CheckboxInput name="escposShowAddress" label="Show address" defaultChecked={values.showAddress} />
      <CheckboxInput name="escposShowPhone" label="Show phone" defaultChecked={values.showPhone} />
      <CheckboxInput name="escposShowGstin" label="Show GSTIN" defaultChecked={values.showGstin} />
      <CheckboxInput name="escposShowCustomer" label="Show customer" defaultChecked={values.showCustomer} />
      <CheckboxInput name="escposShowDiscount" label="Show discount" defaultChecked={values.showDiscount} />
      <CheckboxInput name="escposShowCgst" label="Show CGST" defaultChecked={values.showCgst} />
      <CheckboxInput name="escposShowSgst" label="Show SGST" defaultChecked={values.showSgst} />
      <CheckboxInput name="escposShowPaid" label="Show paid amount" defaultChecked={values.showPaid} />
      <CheckboxInput name="escposShowDue" label="Show due amount" defaultChecked={values.showDue} />
      <CheckboxInput name="escposShowBatch" label="Show batch line" defaultChecked={values.showBatch} />
    </div>
  );
}

function NumberInput({ name, label, defaultValue, min, max }: Readonly<{ name: string; label: string; defaultValue: number; min: number; max: number }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} type="number" min={min} max={max} defaultValue={defaultValue} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600" />
    </label>
  );
}

function CheckboxInput({ name, label, defaultChecked }: Readonly<{ name: string; label: string; defaultChecked: boolean }>) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="size-4 accent-emerald-600" />
      {label}
    </label>
  );
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formNumber(form: FormData, key: string, fallback: number, min: number, max: number): number {
  const value = Number(formString(form, key));
  return Number.isFinite(value) ? Math.max(Math.min(Math.trunc(value), max), min) : fallback;
}

function escposConfigFromForm(form: FormData, previous: unknown) {
  const current = readEscposConfig(previous);
  return {
    ...current,
    layout: formString(form, "escposLayout") || current.layout,
    columns: formNumber(form, "escposColumns", current.columns, 24, 64),
    feedLinesBeforeCut: formNumber(form, "escposFeedLinesBeforeCut", current.feedLinesBeforeCut, 0, 12),
    alternatePhone: formString(form, "escposAlternatePhone"),
    fssaiNumber: formString(form, "escposFssaiNumber"),
    currencyLabel: formString(form, "escposCurrencyLabel") || "Rs",
    logoText: formString(form, "escposLogoText"),
    note: formString(form, "escposNote"),
    footerMessage: formString(form, "escposFooterMessage"),
    spacing: {
      headerBlankLines: formNumber(form, "escposHeaderBlankLines", current.spacing.headerBlankLines, 0, 5),
      itemSerialWidth: formNumber(form, "escposItemSerialWidth", current.spacing.itemSerialWidth, 3, 10),
      itemNameWidth: formNumber(form, "escposItemNameWidth", current.spacing.itemNameWidth, 8, 40),
      itemQtyWidth: formNumber(form, "escposItemQtyWidth", current.spacing.itemQtyWidth, 5, 12),
      itemPriceWidth: formNumber(form, "escposItemPriceWidth", current.spacing.itemPriceWidth, 5, 12),
      itemAmountWidth: formNumber(form, "escposItemAmountWidth", current.spacing.itemAmountWidth, 6, 14),
      lineGapBetweenItems: formNumber(form, "escposLineGapBetweenItems", current.spacing.lineGapBetweenItems, 0, 3),
      summaryItemWidth: formNumber(form, "escposSummaryItemWidth", current.spacing.summaryItemWidth, 8, 24),
      summaryQtyWidth: formNumber(form, "escposSummaryQtyWidth", current.spacing.summaryQtyWidth, 8, 20),
      summaryAmountLabelWidth: formNumber(form, "escposSummaryAmountLabelWidth", current.spacing.summaryAmountLabelWidth, 7, 16),
      summaryAmountWidth: formNumber(form, "escposSummaryAmountWidth", current.spacing.summaryAmountWidth, 7, 16),
      beforeFooterBlankLines: formNumber(form, "escposBeforeFooterBlankLines", current.spacing.beforeFooterBlankLines, 0, 5),
    },
    cut: form.has("escposCut"),
    showAddress: form.has("escposShowAddress"),
    showPhone: form.has("escposShowPhone"),
    showGstin: form.has("escposShowGstin"),
    showCustomer: form.has("escposShowCustomer"),
    showDiscount: form.has("escposShowDiscount"),
    showCgst: form.has("escposShowCgst"),
    showSgst: form.has("escposShowSgst"),
    showPaid: form.has("escposShowPaid"),
    showDue: form.has("escposShowDue"),
    showBatch: form.has("escposShowBatch"),
  };
}

function readEscposConfig(value: unknown) {
  const record = toRecord(value);
  return {
    columns: numberValue(record.columns, 42, 24, 64),
    cut: booleanValue(record.cut, true),
    feedLinesBeforeCut: numberValue(record.feedLinesBeforeCut, 6, 0, 12),
    showShopName: booleanValue(record.showShopName, true),
    showAddress: booleanValue(record.showAddress, true),
    showPhone: booleanValue(record.showPhone, true),
    showGstin: booleanValue(record.showGstin, true),
    showCustomer: booleanValue(record.showCustomer, true),
    showSubtotal: booleanValue(record.showSubtotal, true),
    showDiscount: booleanValue(record.showDiscount, true),
    showDiscountOnlyWhenPresent: booleanValue(record.showDiscountOnlyWhenPresent, true),
    showCgst: booleanValue(record.showCgst, true),
    showSgst: booleanValue(record.showSgst, true),
    showPaid: booleanValue(record.showPaid, true),
    showDue: booleanValue(record.showDue, true),
    showDueOnlyWhenPresent: booleanValue(record.showDueOnlyWhenPresent, true),
    showBatch: booleanValue(record.showBatch, false),
    layout: stringValue(record.layout, "STANDARD"),
    alternatePhone: stringValue(record.alternatePhone, ""),
    fssaiNumber: stringValue(record.fssaiNumber, ""),
    logoText: stringValue(record.logoText, ""),
    note: stringValue(record.note, ""),
    currencyLabel: stringValue(record.currencyLabel, "Rs"),
    footerMessage: stringValue(record.footerMessage, "Thank you. Please visit again."),
    spacing: readEscposSpacing(record.spacing),
    labels: toRecord(record.labels),
  };
}

function readEscposSpacing(value: unknown) {
  const spacing = toRecord(value);
  return {
    headerBlankLines: numberValue(spacing.headerBlankLines, 1, 0, 5),
    itemSerialWidth: numberValue(spacing.itemSerialWidth, 4, 3, 10),
    itemNameWidth: numberValue(spacing.itemNameWidth, 16, 8, 40),
    itemQtyWidth: numberValue(spacing.itemQtyWidth, 7, 5, 12),
    itemPriceWidth: numberValue(spacing.itemPriceWidth, 7, 5, 12),
    itemAmountWidth: numberValue(spacing.itemAmountWidth, 8, 6, 14),
    lineGapBetweenItems: numberValue(spacing.lineGapBetweenItems, 0, 0, 3),
    summaryItemWidth: numberValue(spacing.summaryItemWidth, 12, 8, 24),
    summaryQtyWidth: numberValue(spacing.summaryQtyWidth, 12, 8, 20),
    summaryAmountLabelWidth: numberValue(spacing.summaryAmountLabelWidth, 9, 7, 16),
    summaryAmountWidth: numberValue(spacing.summaryAmountWidth, 9, 7, 16),
    beforeFooterBlankLines: numberValue(spacing.beforeFooterBlankLines, 1, 0, 5),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? Math.max(Math.min(Math.trunc(nextValue), max), min) : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function parseJson(value: string): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function prettyJson(value: unknown): string {
  return value == null ? "" : JSON.stringify(value, null, 2);
}
