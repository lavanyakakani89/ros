"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Globe, Image, Loader2, Palette, Plus, RefreshCw, Save, ShieldCheck, ShoppingBag, Sparkles, Trash2, Upload } from "lucide-react";

import { apiUrl, createAuthenticatedApiClient } from "@/lib/api-client";

type StorefrontStatus = "DISABLED" | "REQUESTED" | "ACTIVE" | "SUSPENDED";
type StorefrontTheme = "CLASSIC_RETAIL" | "PREMIUM_BRAND";
type StorefrontPaymentProvider = "PLATFORM_RAZORPAY" | "TENANT_RAZORPAY";

interface EcommerceSettingsResponse {
  settings: {
    status: StorefrontStatus;
    theme: StorefrontTheme;
    subdomain: string | null;
    defaultHostname: string;
    displayName: string | null;
    logoUrl: string | null;
    banners: Array<{ slot: "banner-1" | "banner-2"; imageUrl: string }>;
    heroTitle: string | null;
    heroSubtitle: string | null;
    primaryColor: string | null;
    accentColor: string | null;
    allowGuestCheckout: boolean;
    allowCustomerLogin: boolean;
    allowCod: boolean;
    paymentProvider: StorefrontPaymentProvider | null;
    tenantRazorpayKeyId: string | null;
    hasTenantRazorpaySecret: boolean;
    deliveryCharge: string;
    freeDeliveryAbove: string;
  };
  subscription: {
    status: string;
    priceOverride: string | null;
    billingCycle: string;
  } | null;
  domains: Array<{
    id: string;
    hostname: string;
    type: "DEFAULT_SUBDOMAIN" | "CUSTOM";
    status: string;
    notes?: string | null;
  }>;
  approvals: Array<{
    id: string;
    type: string;
    status: string;
    notes?: string | null;
    rejectionReason?: string | null;
    requestedAt: string;
  }>;
  pricing: {
    displayName: string;
    basePrice: string;
    currency: string;
    billingCycle: string;
    isActive: boolean;
  } | null;
  defaultHostname: string;
}

interface EcommerceFamilyCatalogResponse {
  families: EcommerceFamilyRecord[];
  suggestions: EcommerceFamilySuggestion[];
  ungroupedProducts: EcommerceFamilyProduct[];
}

interface EcommerceFamilyRecord {
  id: string;
  name: string;
  slug: string;
  attributeLabel: string;
  source: "MANUAL" | "SUGGESTED";
  isActive: boolean;
  items: EcommerceFamilyItem[];
}

interface EcommerceFamilyItem {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  mrp: number;
  sellingPrice: number;
  categoryName: string;
  brand: string | null;
  size: string | null;
  variantLabel: string;
  sortOrder: number;
  isDefault: boolean;
}

interface EcommerceFamilySuggestion {
  key: string;
  name: string;
  attributeLabel: "Size";
  items: Array<{
    productId: string;
    productName: string;
    variantLabel: string;
    sortOrder: number;
    sku: string | null;
    barcode: string | null;
    currentStock: number;
    categoryName: string;
    brand: string | null;
    imageUrl: string | null;
  }>;
}

interface EcommerceFamilyProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  currentStock: number;
  mrp: number;
  sellingPrice: number;
  categoryName: string;
  brand: string | null;
  size: string | null;
  suggestedVariantLabel: string | null;
}

interface SettingsForm {
  theme: StorefrontTheme;
  displayName: string;
  heroTitle: string;
  heroSubtitle: string;
  primaryColor: string;
  accentColor: string;
  deliveryCharge: string;
  freeDeliveryAbove: string;
  allowGuestCheckout: boolean;
  allowCustomerLogin: boolean;
  allowCod: boolean;
  paymentProvider: StorefrontPaymentProvider;
  tenantRazorpayKeyId: string;
  tenantRazorpayKeySecret: string;
}

const emptyForm: SettingsForm = {
  theme: "CLASSIC_RETAIL",
  displayName: "",
  heroTitle: "",
  heroSubtitle: "",
  primaryColor: "#166534",
  accentColor: "#0f766e",
  deliveryCharge: "0",
  freeDeliveryAbove: "0",
  allowGuestCheckout: true,
  allowCustomerLogin: true,
  allowCod: true,
  paymentProvider: "PLATFORM_RAZORPAY",
  tenantRazorpayKeyId: "",
  tenantRazorpayKeySecret: "",
};

export function EcommerceSettingsClient() {
  const api = createAuthenticatedApiClient();
  const [data, setData] = useState<EcommerceSettingsResponse | null>(null);
  const [familyData, setFamilyData] = useState<EcommerceFamilyCatalogResponse | null>(null);
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [domain, setDomain] = useState("");
  const [domainNotes, setDomainNotes] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [familyAttributeLabel, setFamilyAttributeLabel] = useState("Size");
  const [familySearch, setFamilySearch] = useState("");
  const [selectedUngroupedProductIds, setSelectedUngroupedProductIds] = useState<string[]>([]);
  const [selectedTargetFamilyId, setSelectedTargetFamilyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<string | null>(null);
  const [familyBusy, setFamilyBusy] = useState(false);

  async function loadSettings() {
    setError("");
    const [response, families] = await Promise.all([
      api.get<EcommerceSettingsResponse>("/storefront/settings"),
      api.get<EcommerceFamilyCatalogResponse>("/storefront/product-families"),
    ]);
    setData(response);
    setFamilyData(families);
    setForm(formFromSettings(response));
    setLoading(false);
  }

  useEffect(() => {
    void loadSettings().catch((loadError: unknown) => {
      setError(readError(loadError));
      setLoading(false);
    });
  }, []);

  function updateField<Key extends keyof SettingsForm>(field: Key, value: SettingsForm[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleUngroupedProduct(productId: string) {
    setSelectedUngroupedProductIds((current) =>
      current.includes(productId)
        ? current.filter((value) => value !== productId)
        : [...current, productId]);
  }

  function updateFamilyRecord(familyId: string, updater: (family: EcommerceFamilyRecord) => EcommerceFamilyRecord) {
    setFamilyData((current) => current ? {
      ...current,
      families: current.families.map((family) => family.id === familyId ? updater(family) : family),
    } : current);
  }

  async function reloadFamilies() {
    const families = await api.get<EcommerceFamilyCatalogResponse>("/storefront/product-families");
    setFamilyData(families);
  }

  async function requestEnable() {
    setSaving(true);
    setError("");
    try {
      await api.post("/storefront/request-enable", {});
      setNotice("Ecommerce enablement request sent to super admin.");
      await loadSettings();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function requestSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/storefront/settings/request", cleanPayload({
        requestType: form.paymentProvider === "TENANT_RAZORPAY" || form.tenantRazorpayKeySecret ? "PAYMENT" : "SETTINGS",
        theme: form.theme,
        displayName: form.displayName,
        heroTitle: form.heroTitle,
        heroSubtitle: form.heroSubtitle,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        deliveryCharge: Number(form.deliveryCharge || 0),
        freeDeliveryAbove: Number(form.freeDeliveryAbove || 0),
        allowGuestCheckout: form.allowGuestCheckout,
        allowCustomerLogin: form.allowCustomerLogin,
        allowCod: form.allowCod,
        paymentProvider: form.paymentProvider,
        tenantRazorpayKeyId: form.tenantRazorpayKeyId,
        tenantRazorpayKeySecret: form.tenantRazorpayKeySecret,
      }));
      setNotice("Ecommerce change request sent to super admin.");
      updateField("tenantRazorpayKeySecret", "");
      await loadSettings();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function requestDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/storefront/domain-requests", cleanPayload({ hostname: domain, notes: domainNotes }));
      setNotice("Domain request sent to super admin.");
      setDomain("");
      setDomainNotes("");
      await loadSettings();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function uploadMedia(asset: "logo" | "banner-1" | "banner-2", file: File | undefined) {
    if (!file) return;
    const limit = mediaLimit(asset);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Upload a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > limit.bytes) {
      setError(`${limit.label} must be ${String(Math.floor(limit.bytes / 1024))} KB or smaller.`);
      return;
    }

    setMediaBusy(asset);
    setError("");
    try {
      await api.upload(`/storefront/media/${asset}`, file);
      setNotice(`${limit.label} uploaded.`);
      await loadSettings();
    } catch (uploadError) {
      setError(readError(uploadError));
    } finally {
      setMediaBusy(null);
    }
  }

  async function deleteMedia(asset: "logo" | "banner-1" | "banner-2") {
    setMediaBusy(asset);
    setError("");
    try {
      await api.delete(`/storefront/media/${asset}`);
      setNotice(`${mediaLimit(asset).label} removed.`);
      await loadSettings();
    } catch (deleteError) {
      setError(readError(deleteError));
    } finally {
      setMediaBusy(null);
    }
  }

  async function createManualFamily() {
    if (selectedUngroupedProductIds.length < 2) {
      setError("Select at least two products to create a variant family.");
      return;
    }
    if (!familyName.trim()) {
      setError("Enter a family name.");
      return;
    }

    setFamilyBusy(true);
    setError("");
    try {
      const products = (familyData?.ungroupedProducts ?? []).filter((product) => selectedUngroupedProductIds.includes(product.id));
      await api.post("/storefront/product-families", {
        name: familyName.trim(),
        attributeLabel: familyAttributeLabel.trim() || "Size",
        source: "MANUAL",
        items: products.map((product, index) => ({
          productId: product.id,
          variantLabel: product.suggestedVariantLabel ?? product.size ?? product.name,
          sortOrder: index,
          isDefault: index === 0,
        })),
      });
      setNotice("Product family created.");
      setFamilyName("");
      setFamilyAttributeLabel("Size");
      setSelectedUngroupedProductIds([]);
      await reloadFamilies();
    } catch (familyError) {
      setError(readError(familyError));
    } finally {
      setFamilyBusy(false);
    }
  }

  async function createSuggestedFamily(suggestion: EcommerceFamilySuggestion) {
    setFamilyBusy(true);
    setError("");
    try {
      await api.post("/storefront/product-families", {
        name: suggestion.name,
        attributeLabel: suggestion.attributeLabel,
        source: "SUGGESTED",
        items: suggestion.items.map((item, index) => ({
          productId: item.productId,
          variantLabel: item.variantLabel,
          sortOrder: item.sortOrder,
          isDefault: index === 0,
        })),
      });
      setNotice(`${suggestion.name} family created.`);
      await reloadFamilies();
    } catch (familyError) {
      setError(readError(familyError));
    } finally {
      setFamilyBusy(false);
    }
  }

  async function addSelectedProductsToFamily() {
    if (!selectedTargetFamilyId || selectedUngroupedProductIds.length === 0) {
      setError("Choose a family and at least one ungrouped product.");
      return;
    }

    setFamilyBusy(true);
    setError("");
    try {
      const products = (familyData?.ungroupedProducts ?? []).filter((product) => selectedUngroupedProductIds.includes(product.id));
      await api.post(`/storefront/product-families/${selectedTargetFamilyId}/items`, {
        items: products.map((product, index) => ({
          productId: product.id,
          variantLabel: product.suggestedVariantLabel ?? product.size ?? product.name,
          sortOrder: index,
        })),
      });
      setNotice("Products added to family.");
      setSelectedUngroupedProductIds([]);
      setSelectedTargetFamilyId("");
      await reloadFamilies();
    } catch (familyError) {
      setError(readError(familyError));
    } finally {
      setFamilyBusy(false);
    }
  }

  async function saveFamily(family: EcommerceFamilyRecord) {
    setFamilyBusy(true);
    setError("");
    try {
      await api.patch(`/storefront/product-families/${family.id}`, {
        name: family.name,
        attributeLabel: family.attributeLabel,
        items: family.items.map((item) => ({
          id: item.id,
          variantLabel: item.variantLabel,
          sortOrder: item.sortOrder,
          isDefault: item.isDefault,
        })),
      });
      setNotice(`${family.name} updated.`);
      await reloadFamilies();
    } catch (familyError) {
      setError(readError(familyError));
    } finally {
      setFamilyBusy(false);
    }
  }

  async function removeFamilyItem(familyId: string, itemId: string) {
    setFamilyBusy(true);
    setError("");
    try {
      await api.delete(`/storefront/product-families/${familyId}/items/${itemId}`);
      setNotice("Variant removed from family.");
      await reloadFamilies();
    } catch (familyError) {
      setError(readError(familyError));
    } finally {
      setFamilyBusy(false);
    }
  }

  async function archiveFamily(familyId: string) {
    setFamilyBusy(true);
    setError("");
    try {
      await api.delete(`/storefront/product-families/${familyId}`);
      setNotice("Product family archived.");
      await reloadFamilies();
    } catch (familyError) {
      setError(readError(familyError));
    } finally {
      setFamilyBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-md border border-border bg-white text-sm text-slate-500">
        Loading ecommerce settings
      </div>
    );
  }

  const settings = data?.settings;
  const active = settings?.status === "ACTIVE";
  const pending = data?.approvals.filter((approval) => approval.status === "REQUESTED") ?? [];
  const filteredUngroupedProducts = (familyData?.ungroupedProducts ?? []).filter((product) => {
    const searchValue = familySearch.trim().toLowerCase();
    if (!searchValue) {
      return true;
    }
    return [product.name, product.sku, product.barcode, product.brand, product.categoryName, product.size]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(searchValue));
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Ecommerce</h1>
          <p className="mt-1 text-sm text-slate-500">Storefront, domain, theme, checkout, and payment requests.</p>
        </div>
        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700" onClick={() => void loadSettings()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <StatusTile icon={<ShoppingBag className="size-4" />} label="Storefront" value={settings?.status ?? "DISABLED"} tone={active ? "green" : "amber"} />
        <StatusTile icon={<ShieldCheck className="size-4" />} label="Subscription" value={data?.subscription?.status ?? "Not configured"} tone={data?.subscription?.status === "ACTIVE" ? "green" : "slate"} />
        <StatusTile icon={<Globe className="size-4" />} label="Default domain" value={settings?.defaultHostname ?? data?.defaultHostname ?? "-"} tone="slate" />
        <StatusTile icon={<CheckCircle2 className="size-4" />} label="Pending approvals" value={String(pending.length)} tone={pending.length ? "amber" : "green"} />
      </section>

      {!active ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-amber-950">Ecommerce is not active yet</div>
              <div className="mt-1 text-sm text-amber-800">Your default domain will be {data?.defaultHostname ?? settings?.defaultHostname ?? "<tenant>.bizbil.com"} after superadmin approval.</div>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-amber-500 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} onClick={() => void requestEnable()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Request enablement
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
        <form className="rounded-md border border-border bg-white p-4" onSubmit={requestSettings}>
          <div className="mb-4 flex items-center gap-2 font-semibold text-slate-950">
            <Palette className="size-4 text-emerald-600" aria-hidden="true" />
            Storefront settings
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField label="Theme" value={form.theme} options={["CLASSIC_RETAIL", "PREMIUM_BRAND"]} onChange={(value) => updateField("theme", value as StorefrontTheme)} />
            <TextField label="Display name" value={form.displayName} onChange={(value) => updateField("displayName", value)} />
            <TextField label="Hero title" value={form.heroTitle} onChange={(value) => updateField("heroTitle", value)} />
            <TextField label="Hero subtitle" value={form.heroSubtitle} onChange={(value) => updateField("heroSubtitle", value)} />
            <TextField label="Primary color" type="color" value={form.primaryColor} onChange={(value) => updateField("primaryColor", value)} />
            <TextField label="Accent color" type="color" value={form.accentColor} onChange={(value) => updateField("accentColor", value)} />
            <TextField label="Delivery charge" type="number" value={form.deliveryCharge} onChange={(value) => updateField("deliveryCharge", value)} />
            <TextField label="Free delivery above" type="number" value={form.freeDeliveryAbove} onChange={(value) => updateField("freeDeliveryAbove", value)} />
            <SelectField label="Payment provider" value={form.paymentProvider} options={["PLATFORM_RAZORPAY", "TENANT_RAZORPAY"]} onChange={(value) => updateField("paymentProvider", value as StorefrontPaymentProvider)} />
            <TextField label="Tenant Razorpay key id" value={form.tenantRazorpayKeyId} onChange={(value) => updateField("tenantRazorpayKeyId", value)} />
            <TextField label="Tenant Razorpay secret" type="password" value={form.tenantRazorpayKeySecret} onChange={(value) => updateField("tenantRazorpayKeySecret", value)} placeholder={settings?.hasTenantRazorpaySecret ? "Stored secret is already configured" : ""} />
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <CheckboxField label="Guest checkout" checked={form.allowGuestCheckout} onChange={(checked) => updateField("allowGuestCheckout", checked)} />
            <CheckboxField label="Customer login" checked={form.allowCustomerLogin} onChange={(checked) => updateField("allowCustomerLogin", checked)} />
            <CheckboxField label="Cash on delivery" checked={form.allowCod} onChange={(checked) => updateField("allowCod", checked)} />
          </div>
          <button className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Submit for approval
          </button>
        </form>

        <div className="space-y-5">
          <section className="rounded-md border border-border bg-white p-4">
            <div className="mb-4 flex items-center gap-2 font-semibold text-slate-950">
              <Image className="size-4 text-emerald-600" aria-hidden="true" />
              Storefront media
            </div>
            <div className="grid gap-3">
              <MediaUpload
                asset="logo"
                busy={mediaBusy === "logo"}
                imageUrl={settings?.logoUrl ?? null}
                label="Logo"
                recommendation="512 x 512, max 256 KB"
                onDelete={() => void deleteMedia("logo")}
                onUpload={(file) => void uploadMedia("logo", file)}
              />
              <MediaUpload
                asset="banner-1"
                busy={mediaBusy === "banner-1"}
                imageUrl={settings?.banners.find((banner) => banner.slot === "banner-1")?.imageUrl ?? null}
                label="Banner 1"
                recommendation="1600 x 500, max 700 KB"
                wide
                onDelete={() => void deleteMedia("banner-1")}
                onUpload={(file) => void uploadMedia("banner-1", file)}
              />
              <MediaUpload
                asset="banner-2"
                busy={mediaBusy === "banner-2"}
                imageUrl={settings?.banners.find((banner) => banner.slot === "banner-2")?.imageUrl ?? null}
                label="Banner 2"
                recommendation="1600 x 500, max 700 KB"
                wide
                onDelete={() => void deleteMedia("banner-2")}
                onUpload={(file) => void uploadMedia("banner-2", file)}
              />
            </div>
          </section>

          <form className="rounded-md border border-border bg-white p-4" onSubmit={requestDomain}>
            <div className="mb-4 flex items-center gap-2 font-semibold text-slate-950">
              <Globe className="size-4 text-blue-600" aria-hidden="true" />
              Custom domain
            </div>
            <div className="grid gap-3">
              <TextField label="Domain" value={domain} onChange={setDomain} placeholder="www.example.com" required />
              <TextField label="Notes" value={domainNotes} onChange={setDomainNotes} />
            </div>
            <button className="mt-4 h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">
              Request domain
            </button>
          </form>

          <section className="rounded-md border border-border bg-white">
            <div className="border-b border-border px-4 py-3 font-semibold text-slate-950">Domains</div>
            <div className="divide-y divide-border">
              {(data?.domains ?? []).length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No domains requested yet.</div>
              ) : data?.domains.map((item) => (
                <div className="flex items-center justify-between gap-3 p-4 text-sm" key={item.id}>
                  <div>
                    <div className="font-medium text-slate-950">{item.hostname}</div>
                    <div className="text-xs text-slate-500">{formatLabel(item.type)}</div>
                  </div>
                  <span className={statusClass(item.status)}>{item.status}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-border bg-white">
            <div className="border-b border-border px-4 py-3 font-semibold text-slate-950">Recent requests</div>
            <div className="divide-y divide-border">
              {(data?.approvals ?? []).length === 0 ? (
                <div className="p-4 text-sm text-slate-500">No requests yet.</div>
              ) : data?.approvals.slice(0, 8).map((item) => (
                <div className="p-4 text-sm" key={item.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-slate-950">{formatLabel(item.type)}</div>
                    <span className={statusClass(item.status)}>{item.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatDate(item.requestedAt)}</div>
                  {item.rejectionReason ? <div className="mt-1 text-xs text-red-600">{item.rejectionReason}</div> : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="rounded-md border border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <Sparkles className="size-4 text-emerald-600" aria-hidden="true" />
              Product variant families
            </div>
            <p className="mt-1 text-sm text-slate-500">Group separate POS products into one ecommerce product page with selectable variants. POS products remain unchanged.</p>
          </div>
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700 disabled:opacity-60" disabled={familyBusy} onClick={() => void reloadFamilies()}>
            <RefreshCw className={`size-4 ${familyBusy ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh families
          </button>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <section className="rounded-md border border-border bg-slate-50 p-4">
              <div className="font-semibold text-slate-950">Suggested groups</div>
              <div className="mt-1 text-sm text-slate-500">We auto-detect likely size-based variants. Review and create only the groups you want online.</div>
              <div className="mt-4 space-y-3">
                {(familyData?.suggestions ?? []).length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-white p-4 text-sm text-slate-500">No suggestions available right now.</div>
                ) : (familyData?.suggestions ?? []).map((suggestion) => (
                  <div className="rounded-md border border-border bg-white p-4" key={suggestion.key}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-950">{suggestion.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{suggestion.items.length} products grouped by {suggestion.attributeLabel.toLowerCase()}</div>
                      </div>
                      <button className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-60" disabled={familyBusy} onClick={() => void createSuggestedFamily(suggestion)}>
                        <Plus className="size-3.5" />
                        Create
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {suggestion.items.map((item) => (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600" key={item.productId}>
                          {item.variantLabel}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-border bg-slate-50 p-4">
              <div className="font-semibold text-slate-950">Manual family builder</div>
              <div className="mt-1 text-sm text-slate-500">Select ungrouped products, give the family a clean name, and optionally add products to an existing family.</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <TextField label="Family name" value={familyName} onChange={setFamilyName} placeholder="Groundnut Oil" />
                <TextField label="Variant label" value={familyAttributeLabel} onChange={setFamilyAttributeLabel} placeholder="Size" />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_240px_auto]">
                <TextField label="Search products" value={familySearch} onChange={setFamilySearch} placeholder="Search by product, SKU, barcode, brand" />
                <label className="block text-sm font-medium text-slate-700">
                  Add selected to family
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-500"
                    value={selectedTargetFamilyId}
                    onChange={(event) => setSelectedTargetFamilyId(event.target.value)}
                  >
                    <option value="">Choose family</option>
                    {(familyData?.families ?? []).map((family) => (
                      <option key={family.id} value={family.id}>{family.name}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <button className="h-10 w-full rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60" disabled={familyBusy || selectedUngroupedProductIds.length === 0 || !selectedTargetFamilyId} onClick={() => void addSelectedProductsToFamily()}>
                    Add selected
                  </button>
                </div>
              </div>
              <div className="mt-4 max-h-[360px] overflow-y-auto rounded-md border border-border bg-white">
                <div className="divide-y divide-border">
                  {filteredUngroupedProducts.slice(0, 120).map((product) => (
                    <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm" key={product.id}>
                      <div className="flex min-w-0 items-center gap-3">
                        <input className="size-4 accent-emerald-600" type="checkbox" checked={selectedUngroupedProductIds.includes(product.id)} onChange={() => toggleUngroupedProduct(product.id)} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-950">{product.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{[product.brand, product.categoryName, product.suggestedVariantLabel ?? product.size].filter(Boolean).join(" | ")}</div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold text-slate-950">{formatCurrency(product.sellingPrice)}</div>
                        <div className="text-xs text-slate-500">{product.currentStock} in stock</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={familyBusy || selectedUngroupedProductIds.length < 2} onClick={() => void createManualFamily()}>
                  {familyBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Create family from selected
                </button>
                <div className="text-sm text-slate-500">{selectedUngroupedProductIds.length} products selected</div>
              </div>
            </section>
          </div>

          <section className="rounded-md border border-border bg-slate-50 p-4">
            <div className="font-semibold text-slate-950">Existing families</div>
            <div className="mt-1 text-sm text-slate-500">Edit display names, variant labels, default option, or archive the family if you no longer need it.</div>
            <div className="mt-4 space-y-4">
              {(familyData?.families ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-white p-4 text-sm text-slate-500">No product families created yet.</div>
              ) : (familyData?.families ?? []).map((family) => (
                <div className="rounded-md border border-border bg-white p-4" key={family.id}>
                  <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                    <TextField label="Family name" value={family.name} onChange={(value) => updateFamilyRecord(family.id, (current) => ({ ...current, name: value }))} />
                    <TextField label="Variant label" value={family.attributeLabel} onChange={(value) => updateFamilyRecord(family.id, (current) => ({ ...current, attributeLabel: value }))} />
                    <div className="flex items-end gap-2">
                      <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={familyBusy} onClick={() => void saveFamily(family)}>
                        Save
                      </button>
                      <button className="inline-flex size-10 items-center justify-center rounded-md border border-red-100 bg-white text-red-600 disabled:opacity-60" disabled={familyBusy} onClick={() => void archiveFamily(family.id)} aria-label={`Archive ${family.name}`}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {family.items.map((item) => (
                      <div className="grid gap-2 rounded-md border border-border bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_160px_90px_90px_auto] md:items-center" key={item.id}>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-950">{item.productName}</div>
                          <div className="mt-1 text-xs text-slate-500">{[item.brand, item.categoryName, item.sku].filter(Boolean).join(" | ")}</div>
                        </div>
                        <TextField label="Variant" value={item.variantLabel} onChange={(value) => updateFamilyRecord(family.id, (current) => ({
                          ...current,
                          items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, variantLabel: value } : candidate),
                        }))} />
                        <TextField label="Order" type="number" value={String(item.sortOrder)} onChange={(value) => updateFamilyRecord(family.id, (current) => ({
                          ...current,
                          items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, sortOrder: Number(value || 0) } : candidate),
                        }))} />
                        <label className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-slate-700">
                          <input className="size-4 accent-emerald-600" type="radio" name={`default-${family.id}`} checked={item.isDefault} onChange={() => updateFamilyRecord(family.id, (current) => ({
                            ...current,
                            items: current.items.map((candidate) => ({ ...candidate, isDefault: candidate.id === item.id })),
                          }))} />
                          Default
                        </label>
                        <button className="inline-flex h-10 items-center justify-center rounded-md border border-red-100 bg-white px-3 text-sm font-semibold text-red-600 disabled:opacity-60" disabled={familyBusy} onClick={() => void removeFamilyItem(family.id, item.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function formFromSettings(response: EcommerceSettingsResponse): SettingsForm {
  const settings = response.settings;
  return {
    theme: settings.theme,
    displayName: settings.displayName ?? "",
    heroTitle: settings.heroTitle ?? "",
    heroSubtitle: settings.heroSubtitle ?? "",
    primaryColor: settings.primaryColor ?? "#166534",
    accentColor: settings.accentColor ?? "#0f766e",
    deliveryCharge: settings.deliveryCharge,
    freeDeliveryAbove: settings.freeDeliveryAbove,
    allowGuestCheckout: settings.allowGuestCheckout,
    allowCustomerLogin: settings.allowCustomerLogin,
    allowCod: settings.allowCod,
    paymentProvider: settings.paymentProvider ?? "PLATFORM_RAZORPAY",
    tenantRazorpayKeyId: settings.tenantRazorpayKeyId ?? "",
    tenantRazorpayKeySecret: "",
  };
}

function StatusTile({ icon, label, value, tone }: Readonly<{ icon: React.ReactNode; label: string; value: string; tone: "green" | "amber" | "slate" }>) {
  const toneClass = tone === "green" ? "bg-emerald-50 text-emerald-700" : tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600";
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
        <span className={`grid size-7 place-items-center rounded-md ${toneClass}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-3 break-words text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "color" | "number" | "password" | "text";
  placeholder?: string;
  required?: boolean;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-500"
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: Readonly<{ label: string; value: string; options: readonly string[]; onChange: (value: string) => void }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({ label, checked, onChange }: Readonly<{ label: string; checked: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <label className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-slate-50 px-3 text-sm font-medium text-slate-700">
      <input className="size-4 accent-emerald-600" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function MediaUpload({
  asset,
  busy,
  imageUrl,
  label,
  recommendation,
  wide = false,
  onDelete,
  onUpload,
}: Readonly<{
  asset: string;
  busy: boolean;
  imageUrl: string | null;
  label: string;
  recommendation: string;
  wide?: boolean;
  onDelete: () => void;
  onUpload: (file: File | undefined) => void;
}>) {
  return (
    <div className="rounded-md border border-border bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">{label}</div>
          <div className="mt-1 text-xs text-slate-500">{recommendation}</div>
        </div>
        {imageUrl ? (
          <button className="inline-flex size-8 items-center justify-center rounded-md border border-red-100 bg-white text-red-600 disabled:opacity-50" disabled={busy} type="button" onClick={onDelete} aria-label={`Remove ${label}`}>
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={`mt-3 overflow-hidden rounded-md border border-dashed border-slate-300 bg-white ${wide ? "aspect-[16/5]" : "size-24"}`}>
        {imageUrl ? (
          <img className="h-full w-full object-cover" src={versionedMediaUrl(imageUrl)} alt={`${label} preview`} />
        ) : (
          <div className="grid h-full place-items-center text-xs font-semibold uppercase text-slate-400">{wide ? "Banner" : "Logo"}</div>
        )}
      </div>
      <label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-700">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
        {busy ? "Uploading" : "Upload"}
        <input
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={busy}
          type="file"
          onChange={(event) => {
            onUpload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      <div className="mt-2 text-xs text-slate-500">Large images are rejected before upload to keep storage usage low.</div>
      <span className="sr-only">{asset}</span>
    </div>
  );
}

function statusClass(status: string): string {
  const base = "inline-flex rounded px-2 py-1 text-xs font-semibold";
  if (status === "ACTIVE" || status === "APPROVED") {
    return `${base} bg-emerald-50 text-emerald-700`;
  }
  if (status === "REQUESTED") {
    return `${base} bg-amber-50 text-amber-700`;
  }
  if (status === "REJECTED" || status === "SUSPENDED") {
    return `${base} bg-red-50 text-red-700`;
  }
  return `${base} bg-slate-100 text-slate-600`;
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function cleanPayload(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "" && value !== undefined));
}

function mediaLimit(asset: "logo" | "banner-1" | "banner-2"): { label: string; bytes: number } {
  return asset === "logo"
    ? { label: "Logo", bytes: 256 * 1024 }
    : { label: asset === "banner-1" ? "Banner 1" : "Banner 2", bytes: 700 * 1024 };
}

function versionedMediaUrl(path: string): string {
  return `${apiUrl(path)}?v=${String(Date.now())}`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
