"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Edit3, Plus, QrCode, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { getStoredTenant } from "@/lib/vertical-config";

type PaymentMethodType = "cash" | "upi" | "card" | "credit" | "custom";
type SettlementFrequency = "daily" | "weekly" | "monthly" | null;
type IntegrationProvider = "phonepe" | null;

interface PhonePeIntegrationConfigRecord {
  environment: "production" | "uat";
  merchant_id: string;
  store_id: string;
  terminal_id: string | null;
  provider_id: string | null;
  salt_index: number;
  salt_key_configured: boolean;
  qr_expiry_seconds: number;
  handover_timeout_seconds: number;
  auto_accept: boolean;
}

interface PartnerRecord {
  id: string;
  name: string;
}

interface PaymentMethodRecord {
  id: string;
  name: string;
  short_code: string;
  type: PaymentMethodType;
  color: string;
  icon: string;
  keyboard_shortcut: string | null;
  display_order: number;
  is_default: boolean;
  is_active: boolean;
  requires_reference: boolean;
  reference_label: string | null;
  allows_split: boolean;
  upi_id: string | null;
  upi_qr_data: string | null;
  partner_id: string | null;
  opening_balance: number;
  settlement_frequency: SettlementFrequency;
  allowed_roles: string[];
  integration_provider: IntegrationProvider;
  integration_config: PhonePeIntegrationConfigRecord | null;
  manual_override_allowed: boolean;
  transaction_count: number;
}

interface MethodFormState {
  id?: string;
  name: string;
  short_code: string;
  type: PaymentMethodType;
  color: string;
  icon: string;
  display_order: number;
  keyboard_shortcut: string;
  requires_reference: boolean;
  reference_label: string;
  allows_split: boolean;
  upi_id: string;
  partner_id: string;
  settlement_frequency: "" | "daily" | "weekly" | "monthly";
  opening_balance: string;
  allowed_roles: string[];
  integration_provider: "" | "phonepe";
  manual_override_allowed: boolean;
  phonepe_environment: "production" | "uat";
  phonepe_merchant_id: string;
  phonepe_store_id: string;
  phonepe_terminal_id: string;
  phonepe_provider_id: string;
  phonepe_salt_index: string;
  phonepe_salt_key: string;
  phonepe_salt_key_configured: boolean;
  phonepe_qr_expiry_seconds: string;
  phonepe_handover_timeout_seconds: string;
  phonepe_auto_accept: boolean;
  is_default?: boolean;
  transaction_count?: number;
}

const typeOptions: Array<{ value: PaymentMethodType; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "credit", label: "Credit" },
  { value: "custom", label: "Custom" },
];
const colors = ["#1a6e4a", "#7f77dd", "#378add", "#854f0b", "#0f766e", "#be123c", "#4338ca", "#525252"];
const icons = ["ti-cash", "ti-qrcode", "ti-credit-card", "ti-user-dollar", "ti-wallet", "ti-building-bank", "ti-gift", "ti-receipt"];
const roles = ["CASHIER", "MANAGER", "OWNER"];

export function PaymentMethodsSettings() {
  const queryClient = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<MethodFormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const api = createAuthenticatedApiClient();

  const methodsQuery = useQuery({
    queryKey: ["payment-methods", includeInactive],
    queryFn: () => api.get<PaymentMethodRecord[]>(`/payment-methods${includeInactive ? "?includeInactive=true" : ""}`),
  });
  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: () => api.get<PartnerRecord[]>("/partners"),
  });

  const methods = useMemo(() => methodsQuery.data ?? [], [methodsQuery.data]);
  const activeMethods = methods.filter((method) => method.is_active);

  const saveMutation = useMutation({
    mutationFn: (form: MethodFormState) => {
      const payload = toPayload(form);
      return form.id
        ? api.patch<PaymentMethodRecord>(`/payment-methods/${form.id}`, payload)
        : api.post<PaymentMethodRecord>("/payment-methods", payload);
    },
    onSuccess: async () => {
      setMessage("Payment method saved.");
      setEditing(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
        queryClient.invalidateQueries({ queryKey: ["payment-methods", "pos"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean; type: "hard" | "soft" }>(`/payment-methods/${id}`),
    onSuccess: async (result) => {
      setMessage(result.type === "soft" ? "Method archived because it has history." : "Method deleted.");
      await queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ id: string; display_order: number }>) => api.patch("/payment-methods/reorder", items),
    onSuccess: async () => {
      setMessage("Payment methods reordered.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
        queryClient.invalidateQueries({ queryKey: ["payment-methods", "pos"] }),
      ]);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (method: PaymentMethodRecord) => api.patch(`/payment-methods/${method.id}`, { is_active: !method.is_active }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payment-methods"] }),
        queryClient.invalidateQueries({ queryKey: ["payment-methods", "pos"] }),
      ]);
    },
  });

  function openCreate() {
    const nextOrder = (methods.at(-1)?.display_order ?? 0) + 1;
    setEditing({
      name: "",
      short_code: "",
      type: "custom",
      color: "#1a6e4a",
      icon: "ti-cash",
      display_order: nextOrder,
      keyboard_shortcut: nextOrder <= 9 ? `Ctrl+${String(nextOrder)}` : "",
      requires_reference: false,
      reference_label: "",
      allows_split: true,
      upi_id: "",
      partner_id: "",
      settlement_frequency: "",
      opening_balance: "0",
      allowed_roles: [],
      integration_provider: "",
      manual_override_allowed: true,
      phonepe_environment: "production",
      phonepe_merchant_id: "",
      phonepe_store_id: "",
      phonepe_terminal_id: "",
      phonepe_provider_id: "",
      phonepe_salt_index: "1",
      phonepe_salt_key: "",
      phonepe_salt_key_configured: false,
      phonepe_qr_expiry_seconds: "180",
      phonepe_handover_timeout_seconds: "60",
      phonepe_auto_accept: false,
    });
  }

  function moveMethod(index: number, direction: -1 | 1) {
    const next = [...activeMethods];
    const targetIndex = index + direction;
    if (!next[index] || !next[targetIndex]) return;
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    reorderMutation.mutate(next.map((method, itemIndex) => ({ id: method.id, display_order: itemIndex + 1 })));
  }

  function printQr(method: PaymentMethodRecord) {
    if (!method.upi_qr_data) return;
    const storeName = getStoredTenant()?.name ?? "BizBil";
    const printWindow = window.open("", "_blank", "width=420,height=520");
    if (!printWindow) return;
    printWindow.document.title = `${method.name} QR`;
    printWindow.document.head.innerHTML = "<style>@page{size:100mm 120mm;margin:5mm}body{font-family:sans-serif;text-align:center}.store-name{font-size:16pt;font-weight:bold;margin-bottom:8px}.qr{width:80mm;height:80mm}.upi-id{font-size:11pt;margin-top:8px;color:#333}.tagline{font-size:9pt;color:#666;margin-top:4px}</style>";
    printWindow.document.body.innerHTML = `<div class="store-name">${escapeHtml(storeName)}</div><img class="qr" src="${method.upi_qr_data}" alt="UPI QR" /><div class="upi-id">${escapeHtml(method.upi_id ?? "")}</div><div class="tagline">Scan to pay via any UPI app</div>`;
    printWindow.setTimeout(() => printWindow.print(), 0);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} className="size-4 accent-emerald-600" />
          Show archived methods
        </label>
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          Add payment method
        </button>
      </div>

      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
      {methodsQuery.isLoading ? <div className="rounded-md border border-border bg-white p-4 text-sm text-slate-500">Loading payment methods...</div> : null}

      <div className="overflow-hidden rounded-md border border-border bg-white">
        <div className="grid grid-cols-[64px_1.2fr_120px_120px_120px_100px_128px] gap-3 border-b border-border bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500">
          <div>Order</div>
          <div>Method</div>
          <div>Shortcut</div>
          <div>Type</div>
          <div>History</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        {methods.map((method, index) => (
          <div key={method.id} className="grid grid-cols-[64px_1.2fr_120px_120px_120px_100px_128px] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
            <div className="flex items-center gap-1">
              <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => moveMethod(index, -1)} disabled={!method.is_active || index === 0}><ChevronUp className="size-4" /></button>
              <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => moveMethod(index, 1)} disabled={!method.is_active || index >= activeMethods.length - 1}><ChevronDown className="size-4" /></button>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ backgroundColor: method.color }} />
                <span className="truncate font-semibold text-slate-900">{method.name}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{method.short_code}</span>
              </div>
              <div className="mt-1 truncate text-xs text-slate-500">{method.icon}{method.partner_id ? " | partner linked" : ""}</div>
            </div>
            <div>{method.keyboard_shortcut ? <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-xs">{method.keyboard_shortcut}</kbd> : <span className="text-xs text-slate-400">Unassigned</span>}</div>
            <div><span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-600">{method.is_default ? "default" : method.type}</span></div>
            <div className="text-slate-600">{method.transaction_count} txns</div>
            <button className={`h-8 rounded-md px-3 text-xs font-semibold ${method.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`} onClick={() => toggleMutation.mutate(method)}>
              {method.is_active ? "Active" : "Inactive"}
            </button>
            <div className="flex justify-end gap-1">
              {method.type === "upi" && method.upi_qr_data ? <button className="rounded p-2 text-slate-500 hover:bg-slate-100" onClick={() => printQr(method)}><QrCode className="size-4" /></button> : null}
              <button className="rounded p-2 text-slate-500 hover:bg-slate-100" onClick={() => setEditing(fromMethod(method))}><Edit3 className="size-4" /></button>
              <button className="rounded p-2 text-red-600 hover:bg-red-50" onClick={() => {
                const action = method.transaction_count > 0 || method.is_default ? "archive" : "delete";
                if (window.confirm(`${method.name} will be ${action}d.${method.transaction_count > 0 ? ` It has ${method.transaction_count.toString()} transactions and history will stay locked.` : ""}`)) {
                  deleteMutation.mutate(method.id);
                }
              }} disabled={method.is_default && method.type === "cash"}><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
      </div>

      {editing ? (
        <MethodDrawer
          form={editing}
          partners={partnersQuery.data ?? []}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => saveMutation.mutate(editing)}
          isSaving={saveMutation.isPending}
          error={saveMutation.error instanceof Error ? saveMutation.error.message : null}
        />
      ) : null}
    </div>
  );
}

function MethodDrawer({ form, partners, onChange, onClose, onSave, isSaving, error }: Readonly<{
  form: MethodFormState;
  partners: PartnerRecord[];
  onChange: (form: MethodFormState) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  error: string | null;
}>) {
  const isDefaultLocked = Boolean(form.is_default);
  const supportsPhonePe = form.type === "card" || form.type === "upi";
  const phonePeSelected = form.integration_provider === "phonepe";
  const hasStaticUpiConfig = form.type !== "upi" || phonePeSelected || /^[\w.-]+@[\w.-]+$/.test(form.upi_id.trim());
  const hasPhonePeConfig = !phonePeSelected || Boolean(
    form.phonepe_merchant_id.trim() &&
    form.phonepe_store_id.trim() &&
    form.phonepe_salt_index.trim() &&
    (form.phonepe_salt_key.trim() || form.phonepe_salt_key_configured) &&
    (form.type !== "card" || form.phonepe_terminal_id.trim()),
  );
  const isValid = form.name.trim() && form.short_code.trim() && hasStaticUpiConfig && hasPhonePeConfig;
  const set = <K extends keyof MethodFormState>(key: K, value: MethodFormState[K]) => onChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35">
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{form.id ? "Edit method" : "New method"}</div>
            <div className="text-lg font-semibold text-slate-950">{form.name || "Payment method"}</div>
          </div>
          <button className="rounded p-2 text-slate-500 hover:bg-slate-100" onClick={onClose}><X className="size-5" /></button>
        </div>

        <div className="grid gap-4 p-5">
          <TextField label="Method name" value={form.name} onChange={(value) => set("name", value)} required />
          <TextField label="Short code" value={form.short_code} onChange={(value) => set("short_code", value.toUpperCase().slice(0, 12))} disabled={isDefaultLocked} required />
          <label className="block text-sm font-medium text-slate-700">
            Type
            <select
              value={form.type}
              disabled={isDefaultLocked}
              onChange={(event) => {
                const nextType = event.target.value as PaymentMethodType;
                onChange({
                  ...form,
                  type: nextType,
                  integration_provider: nextType === "card" || nextType === "upi" ? form.integration_provider : "",
                });
              }}
              className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm"
            >
              {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <div>
            <div className="text-sm font-medium text-slate-700">Color</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {colors.map((color) => <button key={color} className={`size-8 rounded-full border ${form.color === color ? "ring-2 ring-slate-900 ring-offset-2" : ""}`} style={{ backgroundColor: color }} onClick={() => set("color", color)} aria-label={color} />)}
              <input value={form.color} onChange={(event) => set("color", event.target.value)} className="h-8 w-28 rounded-md border border-border px-2 text-xs" />
            </div>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            Icon
            <select value={form.icon} onChange={(event) => set("icon", event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              {icons.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Display order" value={String(form.display_order)} onChange={(value) => set("display_order", Number(value) || 100)} type="number" />
            <TextField label="Keyboard shortcut" value={form.keyboard_shortcut} onChange={(value) => set("keyboard_shortcut", value)} placeholder="Ctrl+5" />
          </div>

          {supportsPhonePe ? (
            <section className="grid gap-3 rounded-md border border-border p-3">
              <label className="block text-sm font-medium text-slate-700">
                Integration
                <select value={form.integration_provider} onChange={(event) => set("integration_provider", event.target.value as MethodFormState["integration_provider"])} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
                  <option value="">None</option>
                  <option value="phonepe">PhonePe</option>
                </select>
              </label>

              {phonePeSelected ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Environment
                      <select value={form.phonepe_environment} onChange={(event) => set("phonepe_environment", event.target.value as MethodFormState["phonepe_environment"])} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
                        <option value="production">Production</option>
                        <option value="uat">UAT / Sandbox</option>
                      </select>
                    </label>
                    <TextField label="Merchant ID" value={form.phonepe_merchant_id} onChange={(value) => set("phonepe_merchant_id", value)} required />
                    <TextField label="Store ID" value={form.phonepe_store_id} onChange={(value) => set("phonepe_store_id", value)} required />
                    <TextField label="Terminal ID" value={form.phonepe_terminal_id} onChange={(value) => set("phonepe_terminal_id", value)} placeholder={form.type === "card" ? "Required for card terminal" : "Optional for QR"} required={form.type === "card"} />
                    <TextField label="Provider ID" value={form.phonepe_provider_id} onChange={(value) => set("phonepe_provider_id", value)} placeholder="Optional" />
                    <TextField label="Salt index" value={form.phonepe_salt_index} onChange={(value) => set("phonepe_salt_index", value)} type="number" required />
                    <div className="sm:col-span-2">
                      <TextField label="Salt key" value={form.phonepe_salt_key} onChange={(value) => set("phonepe_salt_key", value)} placeholder={form.phonepe_salt_key_configured ? "Saved. Enter only to replace it." : "Paste PhonePe salt key"} required={!form.phonepe_salt_key_configured} />
                      {form.phonepe_salt_key_configured ? <div className="mt-1 text-xs text-slate-500">A PhonePe salt key is already saved for this method.</div> : null}
                    </div>
                    <TextField label="QR expiry (seconds)" value={form.phonepe_qr_expiry_seconds} onChange={(value) => set("phonepe_qr_expiry_seconds", value)} type="number" />
                    <TextField label="Terminal handover timeout (seconds)" value={form.phonepe_handover_timeout_seconds} onChange={(value) => set("phonepe_handover_timeout_seconds", value)} type="number" />
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={form.phonepe_auto_accept} onChange={(event) => set("phonepe_auto_accept", event.target.checked)} className="size-4 accent-emerald-600" />
                    Auto-accept on PhonePe terminal
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={form.manual_override_allowed} onChange={(event) => set("manual_override_allowed", event.target.checked)} className="size-4 accent-emerald-600" />
                    Allow manual override in billing
                  </label>
                  <div className="text-xs text-slate-500">PhonePe callbacks use BizBil&apos;s configured public HTTPS URL when available. Billing can still poll status if callbacks are not reachable.</div>
                </>
              ) : null}
            </section>
          ) : null}

          {form.type === "upi" && !phonePeSelected ? (
            <div className="rounded-md border border-border bg-slate-50 p-3">
              <TextField label="UPI ID" value={form.upi_id} onChange={(value) => set("upi_id", value)} placeholder="sivsan@okicici" required />
              <div className="mt-2 text-xs text-slate-500">QR is generated server-side when this method is saved.</div>
            </div>
          ) : null}

          <section className="grid gap-3 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={phonePeSelected || form.requires_reference} disabled={phonePeSelected} onChange={(event) => set("requires_reference", event.target.checked)} className="size-4 accent-emerald-600" />
              Requires reference
            </label>
            {phonePeSelected ? <div className="text-xs text-slate-500">PhonePe references are saved automatically after terminal or QR verification.</div> : null}
            {phonePeSelected || form.requires_reference ? <TextField label="Reference field label" value={form.reference_label} onChange={(value) => set("reference_label", value)} placeholder={phonePeSelected ? "PhonePe reference" : "Voucher code"} /> : null}
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.allows_split} onChange={(event) => set("allows_split", event.target.checked)} className="size-4 accent-emerald-600" />
              Allow split payment
            </label>
            <div>
              <div className="text-sm font-medium text-slate-700">Restrict to roles</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {roles.map((role) => (
                  <label key={role} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={form.allowed_roles.includes(role)} onChange={(event) => set("allowed_roles", event.target.checked ? [...form.allowed_roles, role] : form.allowed_roles.filter((item) => item !== role))} />
                    {role}
                  </label>
                ))}
              </div>
            </div>
          </section>

          {form.type === "custom" ? (
            <section className="grid gap-3 rounded-md border border-border p-3">
              <label className="block text-sm font-medium text-slate-700">
                Link to partner
                <select value={form.partner_id} onChange={(event) => set("partner_id", event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
                  <option value="">None</option>
                  {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Settlement frequency
                <select value={form.settlement_frequency} onChange={(event) => set("settlement_frequency", event.target.value as MethodFormState["settlement_frequency"])} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
                  <option value="">None</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <TextField label="Opening balance (Rs)" value={form.opening_balance} onChange={(value) => set("opening_balance", value)} type="number" />
            </section>
          ) : null}

          {form.is_default ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Default methods keep their type and short code locked so old receipts and reports continue to resolve correctly.</div> : null}
          {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-white px-5 py-4">
          <button className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-700" onClick={onClose}>Cancel</button>
          <button className="h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={onSave} disabled={!isValid || isSaving}>{isSaving ? "Saving..." : "Save method"}</button>
        </div>
      </aside>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder, disabled = false, required = false }: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}{required ? " *" : ""}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm disabled:bg-slate-100" />
    </label>
  );
}

function fromMethod(method: PaymentMethodRecord): MethodFormState {
  const phonePeConfig = method.integration_provider === "phonepe" ? method.integration_config : null;
  return {
    id: method.id,
    name: method.name,
    short_code: method.short_code,
    type: method.type,
    color: method.color,
    icon: method.icon,
    display_order: method.display_order,
    keyboard_shortcut: method.keyboard_shortcut ?? "",
    requires_reference: method.requires_reference,
    reference_label: method.reference_label ?? "",
    allows_split: method.allows_split,
    upi_id: method.upi_id ?? "",
    partner_id: method.partner_id ?? "",
    settlement_frequency: method.settlement_frequency ?? "",
    opening_balance: String(method.opening_balance),
    allowed_roles: method.allowed_roles,
    integration_provider: method.integration_provider ?? "",
    manual_override_allowed: method.manual_override_allowed,
    phonepe_environment: phonePeConfig?.environment ?? "production",
    phonepe_merchant_id: phonePeConfig?.merchant_id ?? "",
    phonepe_store_id: phonePeConfig?.store_id ?? "",
    phonepe_terminal_id: phonePeConfig?.terminal_id ?? "",
    phonepe_provider_id: phonePeConfig?.provider_id ?? "",
    phonepe_salt_index: phonePeConfig?.salt_index ? String(phonePeConfig.salt_index) : "1",
    phonepe_salt_key: "",
    phonepe_salt_key_configured: phonePeConfig?.salt_key_configured ?? false,
    phonepe_qr_expiry_seconds: phonePeConfig?.qr_expiry_seconds ? String(phonePeConfig.qr_expiry_seconds) : "180",
    phonepe_handover_timeout_seconds: phonePeConfig?.handover_timeout_seconds ? String(phonePeConfig.handover_timeout_seconds) : "60",
    phonepe_auto_accept: phonePeConfig?.auto_accept ?? false,
    is_default: method.is_default,
    transaction_count: method.transaction_count,
  };
}

function toPayload(form: MethodFormState) {
  const phonePeSelected = form.integration_provider === "phonepe";
  return {
    name: form.name.trim(),
    short_code: form.short_code.trim().toUpperCase(),
    type: form.type,
    color: form.color,
    icon: form.icon,
    keyboard_shortcut: form.keyboard_shortcut.trim() || null,
    display_order: form.display_order,
    requires_reference: phonePeSelected ? true : form.requires_reference,
    reference_label: phonePeSelected
      ? form.reference_label.trim() || "PhonePe reference"
      : form.requires_reference
        ? form.reference_label.trim() || null
        : null,
    allows_split: form.allows_split,
    upi_id: form.type === "upi" && !phonePeSelected ? form.upi_id.trim() : null,
    partner_id: form.partner_id || null,
    opening_balance: Number(form.opening_balance) || 0,
    settlement_frequency: form.settlement_frequency || null,
    allowed_roles: form.allowed_roles,
    integration_provider: phonePeSelected ? "phonepe" : null,
    integration_config: phonePeSelected ? {
      environment: form.phonepe_environment,
      merchant_id: form.phonepe_merchant_id.trim(),
      store_id: form.phonepe_store_id.trim(),
      terminal_id: form.phonepe_terminal_id.trim() || null,
      provider_id: form.phonepe_provider_id.trim() || null,
      salt_index: Number(form.phonepe_salt_index) || 1,
      salt_key: form.phonepe_salt_key.trim() || null,
      qr_expiry_seconds: Number(form.phonepe_qr_expiry_seconds) || 180,
      handover_timeout_seconds: Number(form.phonepe_handover_timeout_seconds) || 60,
      auto_accept: form.phonepe_auto_accept,
    } : null,
    manual_override_allowed: form.manual_override_allowed,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
