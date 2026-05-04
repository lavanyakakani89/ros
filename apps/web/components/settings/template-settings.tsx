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
  const selectedTemplate = useMemo(
    () => templatesQuery.data?.templates.find((template) => template.id === selectedId) ?? templatesQuery.data?.templates[0] ?? null,
    [selectedId, templatesQuery.data?.templates],
  );
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
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/templates/${id}/set-default`, {}),
    onSuccess: async () => {
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
    updateTemplate.mutate({
      id: selectedTemplate.id,
      payload: {
        name: formString(form, "name"),
        description: formString(form, "description") || null,
        paperSize: formString(form, "paperSize"),
        renderType: formString(form, "renderType"),
        htmlSource: formString(form, "htmlSource") || null,
        escposConfig: parseJson(formString(form, "escposConfig")),
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
                <button className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs" onClick={() => cloneTemplate.mutate(template.id)}>
                  <Copy className="size-3" aria-hidden="true" />
                  Clone
                </button>
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
                  Default
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
              <Textarea name="escposConfig" label="ESC/POS JSON" defaultValue={prettyJson(selectedTemplate.escposConfig)} />
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

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
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
