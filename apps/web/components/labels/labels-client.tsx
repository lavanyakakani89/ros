"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Minus, PackagePlus, Printer, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import type { ProductRecord } from "@/lib/api-client";
import { apiUrl, createAuthenticatedApiClient, listAllProducts } from "@/lib/api-client";
import { getImpersonationHeaderToken } from "@/lib/impersonation";
import { cn } from "@/lib/utils";
import type {
  LabelCanvasDefinition,
  LabelCanvasField,
  LabelCodeType,
  LabelFieldType,
  LabelLayoutMode,
  LabelPreviewJob,
  LabelTemplateDraft,
  LabelTemplateRecord,
} from "@/lib/types/labels";
import { LabelCanvasRenderer } from "./label-canvas-renderer";

type StepId = 1 | 2 | 3;
type OutputType = "pdf" | "print";
type LabelFieldPatch = Omit<Partial<LabelCanvasField>, "fontSize" | "fontWeight" | "textContent" | "imageUrl" | "codeType"> & {
  fontSize?: number | undefined;
  fontWeight?: "normal" | "bold" | undefined;
  textContent?: string | undefined;
  imageUrl?: string | undefined;
  codeType?: LabelCodeType | undefined;
};

const DEFAULT_FIELD_SIZES: Record<LabelFieldType, Partial<Pick<LabelCanvasField, "width" | "height" | "fontSize" | "fontWeight">>> = {
  product_name: { width: 44, height: 9, fontSize: 12, fontWeight: "bold" },
  price: { width: 24, height: 7, fontSize: 14, fontWeight: "bold" },
  quantity: { width: 16, height: 6, fontSize: 9 },
  packed_date: { width: 20, height: 5, fontSize: 8 },
  best_before: { width: 20, height: 5, fontSize: 8 },
  qr_code: { width: 18, height: 18 },
  barcode: { width: 48, height: 12 },
  image: { width: 18, height: 18 },
  static_text: { width: 30, height: 6, fontSize: 9, fontWeight: "normal" },
};

export function LabelsClient() {
  const api = useMemo(() => createAuthenticatedApiClient(), []);
  const [step, setStep] = useState<StepId>(1);
  const [templates, setTemplates] = useState<LabelTemplateRecord[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabelTemplateDraft | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [allProducts, setAllProducts] = useState<ProductRecord[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Array<{ product_id: string; quantity: number }>>([]);
  const [previewJob, setPreviewJob] = useState<LabelPreviewJob | null>(null);
  const [outputType, setOutputType] = useState<OutputType>("pdf");
  const [printerStatus, setPrinterStatus] = useState<{ connected: boolean; name: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"green" | "red" | "amber">("green");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (templates.length === 0 || draft) {
      return;
    }

    const nextTemplate = templates[0];
    if (!nextTemplate) {
      return;
    }

    selectTemplate(nextTemplate.id);
  }, [templates, draft]);

  useEffect(() => {
    if (selectedItems.length > 0 || allProducts.length === 0) {
      return;
    }

    const firstProduct = allProducts[0];
    if (!firstProduct) {
      return;
    }

    setSelectedItems([{ product_id: firstProduct.id, quantity: 1 }]);
  }, [allProducts, selectedItems.length]);

  const currentFields = draft?.canvas_json.fields ?? [];
  const selectedField = currentFields.find((field) => field.id === selectedFieldId) ?? null;
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) {
      return allProducts.slice(0, 24);
    }

    return allProducts.filter((product) => {
      return [product.name, product.sku, product.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    }).slice(0, 24);
  }, [allProducts, productSearch]);

  async function loadInitialData() {
    try {
      const [templateResponse, printerResponse, productsResponse] = await Promise.all([
        api.get<{ templates: LabelTemplateRecord[] }>("/labels/templates"),
        api.get<{ connected: boolean; name: string | null }>("/labels/printer-status"),
        listAllProducts({ pageSize: 500 }),
      ]);

      setTemplates(templateResponse.templates);
      setPrinterStatus(printerResponse);
      setAllProducts(productsResponse.data);
      const firstTemplate = templateResponse.templates[0];
      if (firstTemplate) {
        selectTemplate(firstTemplate.id, templateResponse.templates);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to load labels.", "red");
    }
  }

  function notify(nextMessage: string, tone: "green" | "red" | "amber" = "green") {
    setMessage(nextMessage);
    setMessageTone(tone);
  }

  function selectTemplate(id: string | null, sourceTemplates = templates) {
    const template = sourceTemplates.find((item) => item.id === id);
    if (!template) {
      setTemplateId(null);
      setDraft(null);
      setSelectedFieldId(null);
      return;
    }

    setTemplateId(template.id);
    setDraft({
      id: template.id,
      name: template.name,
      width_mm: template.width_mm,
      height_mm: template.height_mm,
      layout_mode: template.layout_mode,
      canvas_json: cloneCanvas(template.canvas_json),
      is_default: template.is_default,
    });
    setSelectedFieldId(template.canvas_json.fields[0]?.id ?? null);
  }

  function createBlankTemplate() {
    const starter: LabelTemplateDraft = {
      id: null,
      name: "New label template",
      width_mm: 80,
      height_mm: 40,
      layout_mode: "1up",
      canvas_json: { fields: [] },
      is_default: false,
    };
    setTemplateId(null);
    setDraft(starter);
    setSelectedFieldId(null);
    setStep(2);
  }

  function updateDraft(patch: Partial<Omit<LabelTemplateDraft, "canvas_json">> & { canvas_json?: LabelCanvasDefinition }) {
    setDraft((current) => (current ? { ...current, ...patch, canvas_json: patch.canvas_json ?? current.canvas_json } : current));
  }

  function updateField(fieldId: string, patch: LabelFieldPatch) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        canvas_json: {
          fields: current.canvas_json.fields.map((field) => (field.id === fieldId ? compactField({ ...field, ...patch }) : field)),
        },
      };
    });
  }

  function removeField(fieldId: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextFields = current.canvas_json.fields.filter((field) => field.id !== fieldId);
      if (selectedFieldId === fieldId) {
        setSelectedFieldId(nextFields[0]?.id ?? null);
      }

      return {
        ...current,
        canvas_json: { fields: nextFields },
      };
    });
  }

  function addField(type: LabelFieldType) {
    const defaults = DEFAULT_FIELD_SIZES[type];
    const id = `${type}-${globalThis.crypto.randomUUID()}`;
    const field: LabelCanvasField = {
      id,
      type,
      x: 4,
      y: 4 + currentFields.length * 2,
      width: defaults.width ?? 24,
      height: defaults.height ?? 8,
      rotation: 0,
    };
    if (defaults.fontSize !== undefined) field.fontSize = defaults.fontSize;
    if (defaults.fontWeight !== undefined) field.fontWeight = defaults.fontWeight;
    if (type === "static_text") field.textContent = "Static text";
    if (type === "barcode") field.codeType = "barcode";
    if (type === "qr_code") field.codeType = "qr";

    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextFields = [...current.canvas_json.fields, field];
      setSelectedFieldId(field.id);
      return {
        ...current,
        canvas_json: { fields: nextFields },
      };
    });
  }

  async function uploadFieldImage(fieldId: string, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api.uploadForm<{ objectName: string; url: string }>("/labels/upload-image", form);
      updateField(fieldId, { imageUrl: result.url });
      notify("Image uploaded.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Image upload failed.", "red");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!draft) {
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: draft.name,
        width_mm: draft.width_mm,
        height_mm: draft.height_mm,
        layout_mode: draft.layout_mode,
        canvas_json: draft.canvas_json,
      };

      if (draft.id && !draft.is_default && !draft.id.startsWith("default-")) {
        await api.patch(`/labels/templates/${draft.id}`, payload);
        notify("Label template updated.");
        await reloadTemplates(draft.id);
      } else {
        const result = await api.post<{ template: LabelTemplateRecord }>("/labels/templates", payload);
        notify("Label template saved.");
        setTemplateId(result.template.id);
        await reloadTemplates(result.template.id);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save template.", "red");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate() {
    if (!draft?.id || draft.is_default || draft.id.startsWith("default-")) {
      notify("Built-in templates cannot be deleted. Save a copy instead.", "amber");
      return;
    }

    setBusy(true);
    try {
      await api.delete(`/labels/templates/${draft.id}`);
      notify("Label template deleted.");
      await reloadTemplates(null);
      setTemplateId(null);
      setDraft(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to delete template.", "red");
    } finally {
      setBusy(false);
    }
  }

  async function reloadTemplates(preferredId: string | null = templateId) {
    const response = await api.get<{ templates: LabelTemplateRecord[] }>("/labels/templates");
    setTemplates(response.templates);
    if (preferredId) {
      const next = response.templates.find((item) => item.id === preferredId);
      if (next) {
        selectTemplate(next.id, response.templates);
      }
    }
  }

  function buildPreviewPayload() {
    if (!draft) {
      return null;
    }

    return {
      canvas_json: draft.canvas_json,
      width_mm: draft.width_mm,
      height_mm: draft.height_mm,
      layout_mode: draft.layout_mode,
      items: selectedItems,
    };
  }

  async function generatePreview() {
    const payload = buildPreviewPayload();
    if (!payload) {
      notify("Select a template first.", "red");
      return;
    }

    if (selectedItems.length === 0) {
      notify("Add at least one product to preview labels.", "amber");
      return;
    }

    setBusy(true);
    try {
      const response = await postJson<{ preview: LabelPreviewJob }>("/labels/preview", payload);
      setPreviewJob(response.preview);
      setStep(3);
      notify("Preview generated.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to generate preview.", "red");
    } finally {
      setBusy(false);
    }
  }

  async function printLabels() {
    const payload = buildPreviewPayload();
    if (!payload) {
      notify("Select a template first.", "red");
      return;
    }

    if (selectedItems.length === 0) {
      notify("Add at least one product before printing.", "red");
      return;
    }

    setBusy(true);
    try {
      if (outputType === "pdf") {
        const response = await fetch(apiUrl("/labels/print"), {
          method: "POST",
          credentials: "include",
          headers: authHeaders({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            ...payload,
            output_type: "pdf",
          }),
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `bizbil-labels-${String(Date.now())}.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
        notify("PDF downloaded.");
      } else {
        const response = await postJson<{ preview: LabelPreviewJob; printer: { connected: boolean; name: string | null } }>("/labels/print", {
          ...payload,
          output_type: "print",
        });
        setPreviewJob(response.preview);
        setPrinterStatus(response.printer);
        notify(response.printer.connected ? "Labels sent to printer." : "Printer not detected. PDF fallback is available.", response.printer.connected ? "green" : "amber");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Label printing failed.", "red");
    } finally {
      setBusy(false);
    }
  }

  function addProduct(product: ProductRecord) {
    setSelectedItems((current) => {
      const existing = current.find((item) => item.product_id === product.id);
      if (existing) {
        return current.map((item) => (item.product_id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { product_id: product.id, quantity: 1 }];
    });
  }

  function changeItemQuantity(productId: string, quantity: number) {
    setSelectedItems((current) =>
      current
        .map((item) => (item.product_id === productId ? { ...item, quantity: Math.max(1, quantity) } : item))
        .filter(Boolean),
    );
  }

  function removeItem(productId: string) {
    setSelectedItems((current) => current.filter((item) => item.product_id !== productId));
  }

  async function postJson<T>(path: string, payload: object): Promise<T> {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: authHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    return response.json() as Promise<T>;
  }

  function authHeaders(base: HeadersInit): Headers {
    const headers = new Headers(base);
    const token = getImpersonationHeaderToken();
    if (token) {
      headers.set("X-Impersonation-Token", token);
    }
    return headers;
  }

  async function readError(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      return body.error ?? body.message ?? "Request failed";
    } catch {
      return "Request failed";
    }
  }

  if (templates.length === 0 || !draft) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
        {message ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</div>
        ) : (
          "Loading label templates…"
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {message ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            messageTone === "green" && "border-emerald-200 bg-emerald-50 text-emerald-800",
            messageTone === "amber" && "border-amber-200 bg-amber-50 text-amber-900",
            messageTone === "red" && "border-red-200 bg-red-50 text-red-700",
          )}
        >
          {message}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Label printing workflow</div>
            <div className="text-xs text-slate-500">Design one label template, preview the selected products, then print through USB ESC/POS or PDF.</div>
          </div>
          <div className="flex items-center gap-2">
            <StepperButton active={step === 1} onClick={() => setStep(1)} label="Template" />
            <StepperButton active={step === 2} onClick={() => setStep(2)} label="Design" />
            <StepperButton active={step === 3} onClick={() => setStep(3)} label="Print" />
          </div>
        </div>
      </section>

      {step === 1 ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Choose a template</div>
                <div className="text-xs text-slate-500">Built-in starter templates are available immediately. Save your edits as a shop template.</div>
              </div>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100" onClick={createBlankTemplate}>
                <Plus className="size-4" aria-hidden="true" />
                New template
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={cn(
                    "rounded-xl border p-4 text-left transition",
                    templateId === template.id ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                  onClick={() => selectTemplate(template.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{template.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {template.width_mm} × {template.height_mm} mm • {template.layout_mode}
                      </div>
                    </div>
                    {template.is_default ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Built-in</span> : null}
                  </div>
                  <div className="mt-4">
                    <LabelCanvasRenderer
                      template={template}
                      fields={template.canvas_json.fields.map((field) => ({ ...field, resolved_content: field.textContent ?? field.type.replace("_", " ") }))}
                      scale={0.18}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Printer status</div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">{printerStatus?.connected ? "Printer connected" : "Printer not connected"}</div>
                  <div className="text-xs text-slate-500">{printerStatus?.name ?? "ATPOS HQ450 L USB ESC/POS"}</div>
                </div>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => void reloadTemplates().then(() => notify("Templates refreshed."))}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Refresh
                </button>
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Labels print via PDF for soft copy or direct USB bitmap output for the HQ450 L.
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Canvas editor</div>
                <div className="text-xs text-slate-500">Edit the template and keep <span className="font-semibold">canvas_json</span> as the single source of truth.</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => void saveTemplate()} disabled={busy}>
                  <Save className="size-4" aria-hidden="true" />
                  Save
                </button>
                <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100" onClick={() => void deleteTemplate()} disabled={busy}>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_18rem]">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm"
                    placeholder="Template name"
                  />
                  <select
                    value={draft.layout_mode}
                    onChange={(event) => updateDraft({ layout_mode: event.target.value as LabelLayoutMode })}
                    className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                  >
                    <option value="1up">1-up</option>
                    <option value="2up">2-up</option>
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-medium text-slate-600">Width (mm)</span>
                    <input
                      type="number"
                      value={draft.width_mm}
                      onChange={(event) => updateDraft({ width_mm: Number(event.target.value) })}
                      className="h-10 w-full rounded-md border border-slate-300 px-3"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-medium text-slate-600">Height (mm)</span>
                    <input
                      type="number"
                      value={draft.height_mm}
                      onChange={(event) => updateDraft({ height_mm: Number(event.target.value) })}
                      className="h-10 w-full rounded-md border border-slate-300 px-3"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-medium text-slate-600">Fields</span>
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          addField(event.target.value as LabelFieldType);
                          event.currentTarget.value = "";
                        }
                      }}
                      className="h-10 w-full rounded-md border border-slate-300 px-3"
                    >
                      <option value="">Add field</option>
                      {["product_name", "price", "quantity", "packed_date", "best_before", "qr_code", "barcode", "image", "static_text"].map((type) => (
                        <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-4">
                  <LabelCanvasRenderer
                    template={draft}
                    fields={draft.canvas_json.fields}
                    scale={1}
                    selectedFieldId={selectedFieldId}
                    onSelectField={(fieldId) => setSelectedFieldId(fieldId)}
                    className="max-w-full"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected field</div>
                  {selectedField ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <FieldInput label="Type" value={selectedField.type.replace(/_/g, " ")} readOnly />
                        <FieldInput label="ID" value={selectedField.id} readOnly />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <NumericInput label="X" value={selectedField.x} onChange={(value) => updateField(selectedField.id, { x: value })} />
                        <NumericInput label="Y" value={selectedField.y} onChange={(value) => updateField(selectedField.id, { y: value })} />
                        <NumericInput label="Width" value={selectedField.width} onChange={(value) => updateField(selectedField.id, { width: value })} />
                        <NumericInput label="Height" value={selectedField.height} onChange={(value) => updateField(selectedField.id, { height: value })} />
                        <NumericInput label="Rotation" value={selectedField.rotation} onChange={(value) => updateField(selectedField.id, { rotation: value })} />
                        <NumericInput label="Font size" value={selectedField.fontSize ?? 0} onChange={(value) => updateField(selectedField.id, { fontSize: value > 0 ? value : undefined })} />
                      </div>
                      {selectedField.type === "static_text" ? (
                        <label className="block space-y-1 text-sm">
                          <span className="text-xs font-medium text-slate-600">Text</span>
                          <textarea
                            value={selectedField.textContent ?? ""}
                            onChange={(event) => updateField(selectedField.id, { textContent: event.target.value })}
                            className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                      ) : null}
                      {selectedField.type === "image" ? (
                        <label className="block space-y-1 text-sm">
                          <span className="text-xs font-medium text-slate-600">Image upload</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) {
                                void uploadFieldImage(selectedField.id, file);
                              }
                            }}
                            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                      ) : null}
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-xs font-medium text-slate-600">Weight</span>
                          <select
                            value={selectedField.fontWeight ?? "normal"}
                            onChange={(event) => updateField(selectedField.id, { fontWeight: event.target.value as "normal" | "bold" })}
                            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
                          >
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                          </select>
                        </label>
                        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100" onClick={() => removeField(selectedField.id)}>
                          <Minus className="size-4" aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-slate-500">Select a field on the canvas to edit its position and style.</div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fields list</div>
                  <div className="mt-3 space-y-2">
                    {draft.canvas_json.fields.map((field) => (
                      <button
                        key={field.id}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm",
                          selectedFieldId === field.id ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50",
                        )}
                        onClick={() => setSelectedFieldId(field.id)}
                      >
                        <span className="font-medium text-slate-900">{field.type.replace(/_/g, " ")}</span>
                        <span className="text-xs text-slate-500">{field.x} × {field.y} mm</span>
                      </button>
                    ))}
                    {draft.canvas_json.fields.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">Your canvas is empty. Add a product name, price, QR code, or barcode to begin.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">Template preview</div>
            <div className="mt-3">
              <LabelCanvasRenderer template={draft} fields={draft.canvas_json.fields} scale={1} className="max-w-full" />
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</div>
              <ul className="mt-2 space-y-2 text-sm text-slate-600">
                <li>• The template canvas stays the source of truth for both preview and print.</li>
                <li>• Save creates a custom template when you start from a built-in preset.</li>
                <li>• Image fields can point to uploaded MinIO assets through the same API.</li>
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Product selection</div>
                <div className="text-xs text-slate-500">Pick products, set quantities, then generate a print preview or send to the printer.</div>
              </div>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => void generatePreview()}>
                <Eye className="size-4" aria-hidden="true" />
                Preview
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
              <Search className="size-4 text-slate-400" aria-hidden="true" />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Search product name, SKU, or barcode"
                className="h-11 w-full border-0 bg-transparent text-sm outline-none"
              />
            </div>

            <div className="mt-3 max-h-[24rem] space-y-2 overflow-auto pr-1">
              {filteredProducts.map((product) => {
                const selected = selectedItems.find((item) => item.product_id === product.id);
                return (
                  <button
                    key={product.id}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:border-emerald-300 hover:bg-emerald-50"
                    onClick={() => addProduct(product)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{product.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {product.sku} • {product.barcode} • Stock {product.currentStock}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                      <PackagePlus className="size-3.5" aria-hidden="true" />
                      {selected ? `Qty ${String(selected.quantity)}` : "Add"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected items</div>
              <div className="mt-3 space-y-3">
                {selectedItems.map((item) => {
                  const product = allProducts.find((candidate) => candidate.id === item.product_id);
                  if (!product) {
                    return null;
                  }

                  return (
                    <div key={item.product_id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{product.name}</div>
                          <div className="text-xs text-slate-500">{product.sku ?? "No SKU"} • {product.barcode ?? "No barcode"}</div>
                        </div>
                        <button className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700" onClick={() => removeItem(product.id)}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button className="rounded-md border border-slate-300 bg-white p-2" onClick={() => changeItemQuantity(product.id, item.quantity - 1)}>
                          <Minus className="size-4" aria-hidden="true" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(event) => changeItemQuantity(product.id, Number(event.target.value))}
                          className="h-10 w-20 rounded-md border border-slate-300 px-3 text-sm"
                        />
                        <button className="rounded-md border border-slate-300 bg-white p-2" onClick={() => changeItemQuantity(product.id, item.quantity + 1)}>
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {selectedItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">No products selected yet.</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Print preview</div>
                <div className="text-xs text-slate-500">Generate the same preview server-side before PDF download or USB printing.</div>
              </div>
              <div className="inline-flex rounded-md border border-slate-300 p-1">
                <button className={cn("rounded px-3 py-1.5 text-sm font-semibold", outputType === "pdf" ? "bg-emerald-600 text-white" : "text-slate-600")} onClick={() => setOutputType("pdf")}>PDF</button>
                <button className={cn("rounded px-3 py-1.5 text-sm font-semibold", outputType === "print" ? "bg-emerald-600 text-white" : "text-slate-600")} onClick={() => setOutputType("print")}>USB print</button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">Printer</span>
                <span className={cn("font-semibold", printerStatus?.connected ? "text-emerald-700" : "text-red-700")}>{printerStatus?.connected ? "Connected" : "Disconnected"}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{printerStatus?.name ?? "ATPOS HQ450 L"}</div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => void generatePreview()} disabled={busy || selectedItems.length === 0}>
                <Eye className="size-4" aria-hidden="true" />
                Generate preview
              </button>
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-600 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700" onClick={() => void printLabels()} disabled={busy || selectedItems.length === 0}>
                {outputType === "pdf" ? <Download className="size-4" aria-hidden="true" /> : <Printer className="size-4" aria-hidden="true" />}
                {outputType === "pdf" ? "Download PDF" : "Print labels"}
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {previewJob ? (
                previewJob.sheets.map((sheet) => (
                  <div key={sheet.index} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <span>Sheet {sheet.index + 1}</span>
                      <span>{sheet.labels.length} label(s)</span>
                    </div>
                    <div className="space-y-3">
                      {sheet.labels.map((label) => {
                        const labelWidthMm = sheet.layout_mode === "2up" ? sheet.width_mm / 2 : sheet.width_mm;
                        return (
                          <div key={`${label.product_id}-${String(sheet.index)}-${String(label.slot_index)}`} className="overflow-hidden rounded-lg border border-slate-200 p-2">
                            <div className="relative" style={{ width: `${String(Math.max(1, sheet.width_mm * 4))}px`, height: `${String(Math.max(1, sheet.height_mm * 4))}px` }}>
                              <div className="absolute top-0" style={{ left: `${String(label.slot_index * labelWidthMm * 4)}px` }}>
                                <LabelCanvasRenderer
                                  template={{ width_mm: labelWidthMm, height_mm: sheet.height_mm }}
                                  fields={label.fields}
                                  scale={0.22}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  Generate a preview to see the exact label output before printing.
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function cloneCanvas(canvas: LabelCanvasDefinition): LabelCanvasDefinition {
  return {
    fields: canvas.fields.map((field) => ({ ...field })),
  };
}

function compactField(field: {
  id: string;
  type: LabelFieldType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  resolved_content?: string | undefined;
  fontSize?: number | undefined;
  fontWeight?: "normal" | "bold" | undefined;
  textContent?: string | undefined;
  imageUrl?: string | undefined;
  codeType?: LabelCodeType | undefined;
}): LabelCanvasField {
  const next: LabelCanvasField = {
    id: field.id,
    type: field.type,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
    rotation: field.rotation,
  };
  if (field.fontSize !== undefined) next.fontSize = field.fontSize;
  if (field.fontWeight !== undefined) next.fontWeight = field.fontWeight;
  if (field.textContent !== undefined) next.textContent = field.textContent;
  if (field.imageUrl !== undefined) next.imageUrl = field.imageUrl;
  if (field.codeType !== undefined) next.codeType = field.codeType;
  if (field.resolved_content !== undefined) next.resolved_content = field.resolved_content;
  return next;
}

function StepperButton({
  active,
  onClick,
  label,
}: Readonly<{
  active: boolean;
  onClick: () => void;
  label: string;
}>) {
  return (
    <button
      className={cn(
        "rounded-full border px-4 py-2 text-sm font-semibold transition",
        active ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function FieldInput({
  label,
  value,
  readOnly = false,
}: Readonly<{
  label: string;
  value: string;
  readOnly?: boolean;
}>) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input value={value} readOnly={readOnly} className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm" />
    </label>
  );
}

function NumericInput({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: number;
  onChange: (value: number) => void;
}>) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
      />
    </label>
  );
}
