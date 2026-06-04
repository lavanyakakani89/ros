"use client";

import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Eye, FileText, Globe, LogOut, PlusCircle, RefreshCw, Save, ShieldAlert, ShoppingBag, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

const verticals = ["PHARMACY", "GROCERY", "FASHION", "HARDWARE", "ELECTRONICS", "RESTAURANT"] as const;
const plans = ["STARTER", "STANDARD", "PROFESSIONAL", "ENTERPRISE"] as const;
const cycles = ["DEMO", "ONE_TIME", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "TWO_YEARLY", "THREE_YEARLY"] as const;
const adminRoles = ["OWNER", "MANAGER", "SUPPORT"] as const;
const paperSizes = ["THERMAL_2", "THERMAL_3", "THERMAL_4", "A5", "A4"] as const;
const renderTypes = ["ESC_POS", "HTML_PDF"] as const;

export interface SuperAdminIdentity {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "MANAGER" | "SUPPORT";
  sessionId?: string;
}

interface DashboardMetrics {
  totalShops: number;
  activeShops: number;
  warningShops: number;
  suspendedShops: number;
  expiringLicenses: number;
  revenue: string;
}

interface ShopRecord {
  id: string;
  name: string;
  slug: string;
  vertical: string;
  phone: string;
  status: "ACTIVE" | "WARNING" | "SUSPENDED";
  createdAt: string;
  license?: {
    plan: string;
    billingCycle: string;
    expiryDate: string;
    amountPaid: string;
  } | null;
  _count?: {
    users: number;
    products: number;
    invoices: number;
  };
}

interface AdminRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface SystemTemplateRecord {
  id: string;
  name: string;
  description?: string | null;
  paperSize: string;
  renderType: string;
  version: number;
  htmlSource?: string | null;
  escposConfig?: unknown;
  uiConfig?: unknown;
}

interface ImpersonationSessionRecord {
  id: string;
  accessLevel: "READ_ONLY" | "WRITE";
  reason?: string | null;
  expiresAt: string;
  endedAt?: string | null;
  endReason?: string | null;
  actionsCount: number;
  createdAt: string;
  isActive: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    vertical: string;
    status: string;
  };
  superAdmin: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

interface EcommerceOverview {
  modulePricing: Array<{
    module: string;
    displayName: string;
    basePrice: string;
    currency: string;
    billingCycle: string;
    isActive: boolean;
  }>;
  shops: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    storefront: {
      status: string;
      theme: string;
      defaultHostname: string;
      paymentProvider: string | null;
      tenantRazorpayKeyId?: string | null;
      hasTenantRazorpaySecret?: boolean;
      deliveryCharge: string;
      freeDeliveryAbove: string;
    } | null;
    domains: Array<{
      hostname: string;
      type: string;
      status: string;
    }>;
    subscription: {
      status: string;
      priceOverride: string | null;
      billingCycle: string;
    } | null;
    pendingApprovalCount: number;
  }>;
  approvals: Array<{
    id: string;
    type: string;
    payload: unknown;
    notes?: string | null;
    requestedAt: string;
    tenant: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
  metrics: {
    active: number;
    requested: number;
    activeDomains: number;
    pendingApprovals: number;
  };
  rootDomain: string;
}

interface CreateShopForm {
  tenantName: string;
  tenantSlug: string;
  vertical: string;
  phone: string;
  gstNumber: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
  ownerUsername: string;
  ownerPhone: string;
  ownerPassword: string;
  plan: string;
  billingCycle: string;
  amountPaid: string;
  paymentRef: string;
  paymentMode: string;
  notes: string;
}

interface CreateAdminForm {
  name: string;
  email: string;
  password: string;
  role: string;
}

interface TemplateForm {
  id: string;
  name: string;
  description: string;
  paperSize: string;
  renderType: string;
  htmlSource: string;
  escposConfig: string;
  uiConfig: string;
}

const emptyShopForm: CreateShopForm = {
  tenantName: "",
  tenantSlug: "",
  vertical: "GROCERY",
  phone: "",
  gstNumber: "",
  address: "",
  ownerName: "",
  ownerEmail: "",
  ownerUsername: "",
  ownerPhone: "",
  ownerPassword: "",
  plan: "STARTER",
  billingCycle: "YEARLY",
  amountPaid: "0",
  paymentRef: "",
  paymentMode: "",
  notes: "",
};

const emptyAdminForm: CreateAdminForm = {
  name: "",
  email: "",
  password: "",
  role: "SUPPORT",
};

const emptyTemplateForm: TemplateForm = {
  id: "",
  name: "",
  description: "",
  paperSize: "THERMAL_3",
  renderType: "ESC_POS",
  htmlSource: "",
  escposConfig: "{}",
  uiConfig: "{}",
};

export function SuperAdminPanel({ admin }: Readonly<{ admin: SuperAdminIdentity }>) {
  const router = useRouter();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [templates, setTemplates] = useState<SystemTemplateRecord[]>([]);
  const [impersonationSessions, setImpersonationSessions] = useState<ImpersonationSessionRecord[]>([]);
  const [ecommerce, setEcommerce] = useState<EcommerceOverview | null>(null);
  const [ecommercePrice, setEcommercePrice] = useState("0");
  const [shopForm, setShopForm] = useState<CreateShopForm>(emptyShopForm);
  const [adminForm, setAdminForm] = useState<CreateAdminForm>(emptyAdminForm);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(emptyTemplateForm);
  const [impersonationTarget, setImpersonationTarget] = useState<ShopRecord | null>(null);
  const [impersonationAccessLevel, setImpersonationAccessLevel] = useState<"READ_ONLY" | "WRITE">("READ_ONLY");
  const [impersonationReason, setImpersonationReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = admin.role === "OWNER" || admin.role === "MANAGER";
  const canManageAdmins = admin.role === "OWNER";

  const loadData = useCallback(async () => {
    setError(null);
    const [dashboardBody, shopsBody, adminsBody, templatesBody, sessionsBody, ecommerceBody] = await Promise.all([
      apiGet<{ metrics: DashboardMetrics }>("/superadmin/dashboard"),
      apiGet<{ shops: ShopRecord[] }>("/superadmin/shops?limit=100"),
      apiGet<{ admins: AdminRecord[] }>("/superadmin/admins"),
      apiGet<{ templates: SystemTemplateRecord[] }>("/superadmin/templates"),
      apiGet<{ sessions: ImpersonationSessionRecord[] }>("/superadmin/impersonate/sessions?active=true&limit=50"),
      apiGet<EcommerceOverview>("/superadmin/ecommerce"),
    ]);

    setMetrics(dashboardBody.metrics);
    setShops(shopsBody.shops);
    setAdmins(adminsBody.admins);
    setTemplates(templatesBody.templates);
    setImpersonationSessions(sessionsBody.sessions);
    setEcommerce(ecommerceBody);
    setEcommercePrice(ecommerceBody.modulePricing.find((item) => item.module === "ECOMMERCE")?.basePrice ?? "0");
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData().catch((err: unknown) => {
      setError(readError(err));
      setLoading(false);
    });
  }, [loadData]);

  function updateShopField(field: keyof CreateShopForm, value: string) {
    setShopForm((current) => ({ ...current, [field]: value }));
  }

  function updateShopName(value: string) {
    setShopForm((current) => {
      const previousGeneratedSlug = slugify(current.tenantName);
      const shouldAutoUpdateSlug = current.tenantSlug.trim() === "" || current.tenantSlug === previousGeneratedSlug;

      return {
        ...current,
        tenantName: value,
        tenantSlug: shouldAutoUpdateSlug ? slugify(value) : current.tenantSlug,
      };
    });
  }

  function updateAdminField(field: keyof CreateAdminForm, value: string) {
    setAdminForm((current) => ({ ...current, [field]: value }));
  }

  function updateTemplateField(field: keyof TemplateForm, value: string) {
    setTemplateForm((current) => ({ ...current, [field]: value }));
  }

  function selectTemplate(template: SystemTemplateRecord) {
    setTemplateForm({
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      paperSize: template.paperSize,
      renderType: template.renderType,
      htmlSource: template.htmlSource ?? "",
      escposConfig: prettyJson(template.escposConfig),
      uiConfig: prettyJson(template.uiConfig),
    });
  }

  async function createShop() {
    setError(null);
    const normalizedSlug = shopForm.tenantSlug.trim().toLowerCase();
    const validationError = validateShopForm({ ...shopForm, tenantSlug: normalizedSlug });
    if (validationError) {
      setError(validationError);
      return;
    }

    if (shops.some((shop) => shop.slug === normalizedSlug)) {
      setError("Shop slug already exists. Use a different slug.");
      return;
    }

    const body = cleanPayload({
      ...shopForm,
      tenantSlug: normalizedSlug,
      amountPaid: Number(shopForm.amountPaid || 0),
    });
    await apiPost("/superadmin/shops", body);
    setShopForm(emptyShopForm);
    setNotice("Shop created");
    await loadData();
  }

  async function createAdmin() {
    setError(null);
    await apiPost("/superadmin/admins", cleanPayload(adminForm));
    setAdminForm(emptyAdminForm);
    setNotice("Super-admin created");
    await loadData();
  }

  async function saveTemplate() {
    setError(null);
    const payload = {
      name: templateForm.name,
      description: templateForm.description || null,
      paperSize: templateForm.paperSize,
      renderType: templateForm.renderType,
      htmlSource: templateForm.htmlSource || null,
      escposConfig: parseJson(templateForm.escposConfig),
      uiConfig: parseJson(templateForm.uiConfig),
    };

    if (templateForm.id) {
      await apiPut(`/superadmin/templates/${templateForm.id}`, payload);
      setNotice("System template updated");
    } else {
      await apiPost("/superadmin/templates", payload);
      setNotice("System template created");
    }

    setTemplateForm(emptyTemplateForm);
    await loadData();
  }

  async function changeShopStatus(shop: ShopRecord, action: "warning" | "suspend" | "reactivate") {
    setError(null);
    await apiPatch(`/superadmin/shops/${shop.id}/${action}`);
    setNotice(`${shop.name} updated`);
    await loadData();
  }

  async function pushSelectedTemplate(shop: ShopRecord) {
    if (!templateForm.id) {
      setError("Select a system template before pushing it to a shop.");
      return;
    }

    setError(null);
    await apiPost(`/superadmin/templates/${templateForm.id}/push/${shop.id}`, {});
    setNotice(`Template pushed to ${shop.name}`);
  }

  function openImpersonationDialog(shop: ShopRecord) {
    setImpersonationTarget(shop);
    setImpersonationAccessLevel("READ_ONLY");
    setImpersonationReason("");
    setError(null);
  }

  async function startImpersonation() {
    if (!impersonationTarget) {
      return;
    }

    setError(null);
    const body = await apiPost<{ shopUrl: string }>(`/superadmin/impersonate/${impersonationTarget.id}`, {
      accessLevel: impersonationAccessLevel,
      reason: impersonationReason,
    });
    window.open(body.shopUrl, "_blank", "noopener");
  }

  async function forceEndImpersonation(session: ImpersonationSessionRecord) {
    setError(null);
    await apiPost(`/superadmin/impersonate/${session.id}/force-end`, {});
    setNotice(`Ended support view for ${session.tenant.name}`);
    await loadData();
  }

  async function saveEcommercePricing() {
    setError(null);
    await apiPut("/superadmin/ecommerce/pricing/ECOMMERCE", {
      basePrice: Number(ecommercePrice || 0),
      displayName: "Ecommerce",
      isActive: true,
    });
    setNotice("Ecommerce pricing updated");
    await loadData();
  }

  async function updateEcommerceStatus(shopId: string, status: "ACTIVE" | "DISABLED" | "SUSPENDED") {
    setError(null);
    await apiPut(`/superadmin/ecommerce/shops/${shopId}`, {
      status,
      subscriptionStatus: status === "ACTIVE" ? "ACTIVE" : status,
    });
    setNotice(`Ecommerce ${status.toLowerCase()}`);
    await loadData();
  }

  async function configureTenantRazorpay(shop: EcommerceOverview["shops"][number]) {
    const keyId = window.prompt("Tenant Razorpay Key ID", shop.storefront?.tenantRazorpayKeyId ?? "");
    if (!keyId?.trim()) {
      return;
    }

    const existingSecret = shop.storefront?.hasTenantRazorpaySecret ? " Leave blank to keep existing secret." : "";
    const keySecret = window.prompt(`Tenant Razorpay Key Secret.${existingSecret}`, "");
    if (keySecret === null) {
      return;
    }

    setError(null);
    await apiPut(`/superadmin/ecommerce/shops/${shop.id}`, cleanPayload({
      paymentProvider: "TENANT_RAZORPAY",
      tenantRazorpayKeyId: keyId.trim(),
      ...(keySecret.trim() ? { tenantRazorpayKeySecret: keySecret.trim() } : {}),
    }));
    setNotice(`Tenant Razorpay configured for ${shop.name}`);
    await loadData();
  }

  async function approveEcommerceRequest(approvalId: string) {
    setError(null);
    await apiPost(`/superadmin/ecommerce/approvals/${approvalId}/approve`, {});
    setNotice("Ecommerce request approved");
    await loadData();
  }

  async function rejectEcommerceRequest(approvalId: string) {
    const reason = window.prompt("Reason for rejection");
    if (!reason?.trim()) {
      return;
    }

    setError(null);
    await apiPost(`/superadmin/ecommerce/approvals/${approvalId}/reject`, { reason });
    setNotice("Ecommerce request rejected");
    await loadData();
  }

  async function logout() {
    await apiPost("/superadmin/auth/logout", {});
    router.replace("/superadmin/login");
  }

  function onCreateShop(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void createShop().catch((err: unknown) => setError(readError(err)));
  }

  function onCreateAdmin(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void createAdmin().catch((err: unknown) => setError(readError(err)));
  }

  function onSaveTemplate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveTemplate().catch((err: unknown) => setError(readError(err)));
  }

  const normalizedShopSlug = shopForm.tenantSlug.trim().toLowerCase();
  const shopSlugExists = normalizedShopSlug !== "" && shops.some((shop) => shop.slug === normalizedShopSlug);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center overflow-hidden rounded-md bg-white">
              <img src="/bizbil-landing/icons/bizbil-mark.png" alt="BizBil" className="h-full w-full object-contain" />
            </div>
            <div className="text-sm text-slate-500">
              <img src="/bizbil-landing/icons/bizbil-wordmark.png" alt="BizBil" className="h-5 w-auto object-contain" />
              <div className="text-xs text-slate-500">
                {admin.name} | {admin.role}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm" onClick={() => void loadData()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-100 px-3 text-sm" onClick={() => void logout()}>
              <LogOut className="size-4" aria-hidden="true" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {notice ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {metricItems(metrics).map((item) => (
            <div key={item.label} className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-xs font-medium uppercase text-slate-500">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? "-" : item.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  <ShoppingBag className="size-4 text-emerald-300" aria-hidden="true" />
                  Ecommerce Platform
                </div>
                <div className="text-sm text-slate-500">
                  {ecommerce?.metrics.active ?? 0} active storefronts / {ecommerce?.metrics.pendingApprovals ?? 0} pending approvals
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="h-9 w-28 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-950"
                  type="number"
                  value={ecommercePrice}
                  onChange={(event) => setEcommercePrice(event.target.value)}
                  aria-label="Ecommerce module price"
                />
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-400 px-3 text-xs font-semibold text-slate-950 disabled:opacity-40"
                  disabled={!canManage}
                  onClick={() => void saveEcommercePricing().catch((err: unknown) => setError(readError(err)))}
                >
                  <Save className="size-3" aria-hidden="true" />
                  Save price
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Shop</th>
                    <th className="px-4 py-3">Storefront</th>
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Subscription</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(ecommerce?.shops ?? []).slice(0, 12).map((shop) => (
                    <tr key={shop.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{shop.name}</div>
                        <div className="text-xs text-slate-500">{shop.slug}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={ecommerceStatusClass(shop.storefront?.status ?? "DISABLED")}>{shop.storefront?.status ?? "DISABLED"}</span>
                        <div className="mt-1 text-xs text-slate-500">{shop.storefront?.theme ?? "No theme"}</div>
                        {shop.storefront?.paymentProvider === "TENANT_RAZORPAY" ? (
                          <div className="mt-1 text-xs text-slate-500">{shop.storefront.hasTenantRazorpaySecret ? "Tenant Razorpay set" : "Tenant Razorpay missing secret"}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Globe className="size-3 text-slate-500" aria-hidden="true" />
                          <span>{shop.storefront?.defaultHostname ?? `${shop.slug}.${ecommerce?.rootDomain ?? "bizbil.com"}`}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{shop.domains.filter((domain) => domain.status === "ACTIVE").length} active domains</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{shop.subscription?.status ?? "Not configured"}</div>
                        <div className="text-xs text-slate-500">{shop.subscription?.priceOverride ? `Rs ${shop.subscription.priceOverride}` : "Default price"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="h-8 rounded-md border border-emerald-200 px-2 text-xs text-emerald-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void updateEcommerceStatus(shop.id, "ACTIVE").catch((err: unknown) => setError(readError(err)))}
                          >
                            Activate
                          </button>
                          <button
                            className="h-8 rounded-md border border-amber-200 px-2 text-xs text-amber-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void updateEcommerceStatus(shop.id, "SUSPENDED").catch((err: unknown) => setError(readError(err)))}
                          >
                            Suspend
                          </button>
                          <button
                            className="h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void updateEcommerceStatus(shop.id, "DISABLED").catch((err: unknown) => setError(readError(err)))}
                          >
                            Disable
                          </button>
                          {shop.pendingApprovalCount > 0 ? <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">{shop.pendingApprovalCount} request(s)</span> : null}
                          <button
                            className="h-8 rounded-md border border-blue-200 px-2 text-xs text-blue-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void configureTenantRazorpay(shop).catch((err: unknown) => setError(readError(err)))}
                          >
                            Tenant Razorpay
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="font-semibold">Ecommerce Approvals</div>
              <div className="text-sm text-slate-500">Enablement, domains, payments, themes, and settings</div>
            </div>
            <div className="divide-y divide-slate-100">
              {(ecommerce?.approvals ?? []).length === 0 ? (
                <div className="px-4 py-5 text-sm text-slate-500">No pending ecommerce requests.</div>
              ) : (
                (ecommerce?.approvals ?? []).slice(0, 8).map((approval) => (
                  <div className="px-4 py-3 text-sm" key={approval.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-950">{approval.tenant.name}</div>
                        <div className="text-xs text-slate-500">{formatSelectOption(approval.type)} / {approval.tenant.slug}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="h-8 rounded-md bg-emerald-400 px-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                          disabled={!canManage}
                          onClick={() => void approveEcommerceRequest(approval.id).catch((err: unknown) => setError(readError(err)))}
                        >
                          Approve
                        </button>
                        <button
                          className="h-8 rounded-md border border-red-200 px-2 text-xs text-red-700 disabled:opacity-40"
                          disabled={!canManage}
                          onClick={() => void rejectEcommerceRequest(approval.id).catch((err: unknown) => setError(readError(err)))}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                    {approval.notes ? <div className="mt-2 text-xs text-slate-500">{approval.notes}</div> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="font-semibold">Shops</div>
                <div className="text-sm text-slate-500">License and access status</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Shop</th>
                    <th className="px-4 py-3">Vertical</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">License</th>
                    <th className="px-4 py-3">Usage</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shops.map((shop) => (
                    <tr key={shop.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-950">{shop.name}</div>
                        <div className="text-xs text-slate-500">{shop.slug}</div>
                      </td>
                      <td className="px-4 py-3">{shop.vertical}</td>
                      <td className="px-4 py-3">
                        <span className={statusClass(shop.status)}>{shop.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div>{shop.license?.plan ?? "No license"}</div>
                        <div className="text-xs text-slate-500">{shop.license ? formatDate(shop.license.expiryDate) : "-"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {(shop._count?.products ?? 0).toString()} products / {(shop._count?.invoices ?? 0).toString()} bills
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-violet-200 px-2 text-xs text-violet-700 disabled:opacity-40"
                            disabled={shop.status === "SUSPENDED"}
                            onClick={() => openImpersonationDialog(shop)}
                          >
                            <Eye className="size-3" aria-hidden="true" />
                            View as shop
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-200 px-2 text-xs text-amber-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void changeShopStatus(shop, "warning").catch((err: unknown) => setError(readError(err)))}
                          >
                            <ShieldAlert className="size-3" aria-hidden="true" />
                            Warn
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-2 text-xs text-red-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void changeShopStatus(shop, "suspend").catch((err: unknown) => setError(readError(err)))}
                          >
                            <ShieldAlert className="size-3" aria-hidden="true" />
                            Suspend
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 px-2 text-xs text-emerald-700 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void changeShopStatus(shop, "reactivate").catch((err: unknown) => setError(readError(err)))}
                          >
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            Active
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-sky-200 px-2 text-xs text-sky-700 disabled:opacity-40"
                            disabled={!canManage || !templateForm.id}
                            onClick={() => void pushSelectedTemplate(shop).catch((err: unknown) => setError(readError(err)))}
                          >
                            <FileText className="size-3" aria-hidden="true" />
                            Push template
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form className="rounded-md border border-slate-200 bg-white p-4" onSubmit={onCreateShop}>
            <div className="mb-4 flex items-center gap-2 font-semibold">
              <PlusCircle className="size-4" aria-hidden="true" />
              Create Shop
            </div>
            <div className="grid gap-3">
              <TextInput label="Shop name" value={shopForm.tenantName} onChange={updateShopName} required />
              <TextInput label="Shop slug" value={shopForm.tenantSlug} onChange={(value) => updateShopField("tenantSlug", value)} required />
              {shopSlugExists ? <div className="text-xs font-medium text-red-300">This shop slug is already used.</div> : null}
              <SelectInput label="Vertical" value={shopForm.vertical} options={verticals} onChange={(value) => updateShopField("vertical", value)} />
              <TextInput label="Phone" value={shopForm.phone} onChange={(value) => updateShopField("phone", value)} required />
              <TextInput label="Owner name" value={shopForm.ownerName} onChange={(value) => updateShopField("ownerName", value)} required />
              <TextInput label="Owner email" type="email" value={shopForm.ownerEmail} onChange={(value) => updateShopField("ownerEmail", value)} required />
              <TextInput label="Owner username" value={shopForm.ownerUsername} onChange={(value) => updateShopField("ownerUsername", value)} />
              <TextInput label="Owner password" type="password" value={shopForm.ownerPassword} onChange={(value) => updateShopField("ownerPassword", value)} minLength={8} required />
              <SelectInput label="Plan" value={shopForm.plan} options={plans} onChange={(value) => updateShopField("plan", value)} />
              <SelectInput label="Billing cycle" value={shopForm.billingCycle} options={cycles} onChange={(value) => updateShopField("billingCycle", value)} />
              <TextInput label="Amount paid" type="number" value={shopForm.amountPaid} onChange={(value) => updateShopField("amountPaid", value)} />
            </div>
            <button className="mt-4 h-10 w-full rounded-md bg-emerald-500 text-sm font-semibold text-slate-950 disabled:opacity-40" type="submit" disabled={!canManage || shopSlugExists}>
              Create shop
            </button>
          </form>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="font-semibold">Active Support Sessions</div>
              <div className="text-sm text-slate-500">Who is currently viewing a shop through support impersonation</div>
            </div>
            <button className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs" onClick={() => void loadData()}>
              <RefreshCw className="size-3" aria-hidden="true" />
              Refresh
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {impersonationSessions.length === 0 ? (
              <div className="px-4 py-5 text-sm text-slate-500">No active support sessions.</div>
            ) : (
              impersonationSessions.map((session) => (
                <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-950">{session.tenant.name}</div>
                    <div className="text-xs text-slate-500">
                      {session.superAdmin.email} | {session.accessLevel} | expires {formatDateTime(session.expiresAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{session.actionsCount} writes</span>
                    <button
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-red-200 px-2 text-xs text-red-700 disabled:opacity-40"
                      disabled={!canManage}
                      onClick={() => void forceEndImpersonation(session).catch((err: unknown) => setError(readError(err)))}
                    >
                      <XCircle className="size-3" aria-hidden="true" />
                      Force end
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="font-semibold">Invoice Templates</div>
                <div className="text-sm text-slate-500">System defaults for shop cloning and fallback selection</div>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {templates.map((template) => (
                <button key={template.id} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-slate-100" onClick={() => selectTemplate(template)}>
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <FileText className="size-4 text-sky-300" aria-hidden="true" />
                      {template.name}
                    </div>
                    <div className="text-slate-500">{template.description ?? "No description"}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>{template.paperSize}</div>
                    <div>{template.renderType} | v{template.version}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <form className="rounded-md border border-slate-200 bg-white p-4" onSubmit={onSaveTemplate}>
            <div className="mb-4 flex items-center gap-2 font-semibold">
              <Save className="size-4" aria-hidden="true" />
              {templateForm.id ? "Edit System Template" : "Create System Template"}
            </div>
            <div className="grid gap-3">
              <TextInput label="Template name" value={templateForm.name} onChange={(value) => updateTemplateField("name", value)} required />
              <TextInput label="Description" value={templateForm.description} onChange={(value) => updateTemplateField("description", value)} />
              <SelectInput label="Paper size" value={templateForm.paperSize} options={paperSizes} onChange={(value) => updateTemplateField("paperSize", value)} />
              <SelectInput label="Render type" value={templateForm.renderType} options={renderTypes} onChange={(value) => updateTemplateField("renderType", value)} />
              <TextAreaInput label="ESC/POS JSON" value={templateForm.escposConfig} onChange={(value) => updateTemplateField("escposConfig", value)} />
              <TextAreaInput label="UI config JSON" value={templateForm.uiConfig} onChange={(value) => updateTemplateField("uiConfig", value)} />
              <TextAreaInput label="HTML source" value={templateForm.htmlSource} onChange={(value) => updateTemplateField("htmlSource", value)} tall />
            </div>
            <div className="mt-4 flex gap-2">
              <button className="h-10 flex-1 rounded-md bg-sky-400 text-sm font-semibold text-slate-950 disabled:opacity-40" type="submit" disabled={!canManage}>
                Save template
              </button>
              <button className="h-10 rounded-md border border-slate-200 px-3 text-sm" type="button" onClick={() => setTemplateForm(emptyTemplateForm)}>
                Clear
              </button>
            </div>
          </form>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.7fr]">
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 font-semibold">Super Admins</div>
            <div className="divide-y divide-slate-100">
              {admins.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-slate-500">{item.email}</div>
                  </div>
                  <div className="text-right">
                    <div>{item.role}</div>
                    <div className={item.isActive ? "text-xs text-emerald-300" : "text-xs text-red-300"}>{item.isActive ? "Active" : "Inactive"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form className="rounded-md border border-slate-200 bg-white p-4" onSubmit={onCreateAdmin}>
            <div className="mb-4 font-semibold">Create Super Admin</div>
            <div className="grid gap-3">
              <TextInput label="Name" value={adminForm.name} onChange={(value) => updateAdminField("name", value)} required />
              <TextInput label="Email" type="email" value={adminForm.email} onChange={(value) => updateAdminField("email", value)} required />
              <TextInput label="Password" type="password" value={adminForm.password} onChange={(value) => updateAdminField("password", value)} required />
              <SelectInput label="Role" value={adminForm.role} options={adminRoles} onChange={(value) => updateAdminField("role", value)} />
            </div>
            <button className="mt-4 h-10 w-full rounded-md bg-slate-100 text-sm font-semibold text-slate-950 disabled:opacity-40" type="submit" disabled={!canManageAdmins}>
              Create admin
            </button>
          </form>
        </section>
      </div>
      {impersonationTarget ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">View as shop</div>
                <div className="text-sm text-slate-500">
                  Start a two-hour support session for {impersonationTarget.name}. No shop password is used.
                </div>
              </div>
              <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={() => setImpersonationTarget(null)}>
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-3">
              <SelectInput
                label="Access level"
                value={impersonationAccessLevel}
                options={canManage ? ["READ_ONLY", "WRITE"] : ["READ_ONLY"]}
                onChange={(value) => setImpersonationAccessLevel(value as "READ_ONLY" | "WRITE")}
              />
              <TextAreaInput
                label={impersonationAccessLevel === "WRITE" ? "Reason (required for write mode)" : "Reason"}
                value={impersonationReason}
                onChange={setImpersonationReason}
              />
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Read-only mode blocks all shop write actions. Write mode still blocks passwords, users, tenant GST/vertical, and lifecycle settings.
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="h-9 rounded-md border border-slate-200 px-3 text-sm" onClick={() => setImpersonationTarget(null)}>
                Cancel
              </button>
              <button
                className="h-9 rounded-md bg-violet-400 px-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
                disabled={impersonationAccessLevel === "WRITE" && impersonationReason.trim().length < 10}
                onClick={() => void startImpersonation().catch((err: unknown) => setError(readError(err)))}
              >
                Start support view
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function metricItems(metrics: DashboardMetrics | null) {
  return [
    { label: "Total", value: metrics?.totalShops.toString() ?? "-" },
    { label: "Active", value: metrics?.activeShops.toString() ?? "-" },
    { label: "Warning", value: metrics?.warningShops.toString() ?? "-" },
    { label: "Suspended", value: metrics?.suspendedShops.toString() ?? "-" },
    { label: "Expiring", value: metrics?.expiringLicenses.toString() ?? "-" },
    { label: "Revenue", value: `Rs ${metrics?.revenue ?? "0"}` },
  ];
}

function statusClass(status: ShopRecord["status"]): string {
  const base = "inline-flex rounded-md px-2 py-1 text-xs font-semibold";
  if (status === "ACTIVE") {
    return `${base} bg-emerald-50 text-emerald-700`;
  }

  if (status === "WARNING") {
    return `${base} bg-amber-50 text-amber-700`;
  }

  return `${base} bg-red-50 text-red-700`;
}

function ecommerceStatusClass(status: string): string {
  const base = "inline-flex rounded-md px-2 py-1 text-xs font-semibold";
  if (status === "ACTIVE") {
    return `${base} bg-emerald-50 text-emerald-700`;
  }
  if (status === "REQUESTED") {
    return `${base} bg-amber-50 text-amber-700`;
  }
  if (status === "SUSPENDED") {
    return `${base} bg-red-50 text-red-700`;
  }

  return `${base} bg-slate-100 text-slate-700`;
}

function validateShopForm(form: CreateShopForm): string | null {
  if (form.tenantName.trim().length < 2) {
    return "Shop name must be at least 2 characters.";
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.tenantSlug.trim())) {
    return "Shop slug can use lowercase letters, numbers, and single hyphens only.";
  }

  if (form.phone.trim().length < 10) {
    return "Shop phone must be at least 10 digits.";
  }

  if (form.ownerName.trim().length < 2) {
    return "Owner name must be at least 2 characters.";
  }

  if (form.ownerUsername.trim() && /\s/.test(form.ownerUsername.trim())) {
    return "Owner username cannot contain spaces.";
  }

  if (form.ownerUsername.trim() && form.ownerUsername.trim().length < 3) {
    return "Owner username must be at least 3 characters.";
  }

  if (form.ownerPassword.length < 8) {
    return "Owner password must be at least 8 characters.";
  }

  return null;
}

function TextInput({
  label,
  value,
  onChange,
  required,
  minLength,
  type = "text",
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
  type?: "email" | "number" | "password" | "text";
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-500"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        minLength={minLength}
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatSelectOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatSelectOption(option: string): string {
  return option
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function TextAreaInput({
  label,
  value,
  onChange,
  tall,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  tall?: boolean;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <textarea
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-950 outline-none focus:border-emerald-500"
        value={value}
        rows={tall ? 8 : 4}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

async function apiPost<T = unknown>(path: string, body: object): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function apiPut<T = unknown>(path: string, body: object): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function apiPatch<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
  });
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string; issues?: Array<{ field?: string; message?: string }> } | null;
    throw new Error(readApiError(body));
  }

  return response.json() as Promise<T>;
}

function cleanPayload(input: object) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "")) as Record<string, string | number>;
}

function readApiError(body: { error?: string; message?: string; issues?: Array<{ field?: string; message?: string }> } | null): string {
  if (body?.issues?.length) {
    return body.issues
      .slice(0, 3)
      .map((issue) => `${fieldLabel(issue.field ?? "")}: ${issue.message ?? "Invalid value"}`)
      .join("; ");
  }

  return body?.error ?? body?.message ?? "Request failed";
}

function fieldLabel(field: string): string {
  if (!field) {
    return "Request";
  }

  return field
    .replace(/\.(\d+)\./g, " $1 ")
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseJson(value: string): unknown {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function prettyJson(value: unknown): string {
  return value == null ? "{}" : JSON.stringify(value, null, 2);
}