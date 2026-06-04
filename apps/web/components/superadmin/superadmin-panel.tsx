"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ClipboardList,
  FileText,
  Layers3,
  LogOut,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

const verticals = ["PHARMACY", "GROCERY", "FASHION", "HARDWARE", "ELECTRONICS", "RESTAURANT"] as const;
const plans = ["STARTER", "STANDARD", "PROFESSIONAL", "ENTERPRISE"] as const;
const cycles = ["DEMO", "ONE_TIME", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "TWO_YEARLY", "THREE_YEARLY"] as const;
const adminRoles = ["OWNER", "MANAGER", "SUPPORT"] as const;
const paperSizes = ["THERMAL_2", "THERMAL_3", "THERMAL_4", "A5", "A4"] as const;
const renderTypes = ["ESC_POS", "HTML_PDF"] as const;
const storefrontStatuses = ["ACTIVE", "DISABLED", "SUSPENDED", "REQUESTED"] as const;
const storefrontThemes = ["CLASSIC_RETAIL", "PREMIUM_BRAND"] as const;
const paymentProviders = ["PLATFORM_RAZORPAY", "TENANT_RAZORPAY"] as const;
const subscriptionStatuses = ["DISABLED", "REQUESTED", "ACTIVE", "SUSPENDED"] as const;
const modules = ["BILLING", "INVENTORY", "ECOMMERCE", "WHATSAPP", "DELIVERY", "PAYROLL", "RESTAURANT"] as const;

type TabId = "overview" | "shops" | "modules" | "ecommerce" | "platform" | "templates" | "admins" | "audit";

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
  license?: LicenseRecord | null;
  moduleSubscriptions?: ModuleSubscriptionRecord[];
  storefrontSettings?: StorefrontSettingsRecord | null;
  storefrontDomains?: DomainRecord[];
  users?: Array<{ id: string; name: string; email: string; username: string | null; role: string; isActive: boolean; createdAt: string }>;
  _count?: {
    users?: number;
    products?: number;
    customers?: number;
    invoices?: number;
    deliveries?: number;
  };
}

interface LicenseRecord {
  plan: string;
  billingCycle: string;
  startDate?: string;
  expiryDate: string;
  amountPaid: string;
  paymentRef?: string | null;
  paymentMode?: string | null;
  notes?: string | null;
}

interface ModuleSubscriptionRecord {
  module: string;
  status: string;
  priceOverride: string | null;
  currency: string;
  billingCycle: string;
  startsAt: string | null;
  expiresAt: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  notes: string | null;
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
  tenant: { id: string; name: string; slug: string; vertical: string; status: string };
  superAdmin: { id: string; name: string; email: string; role: string };
}

interface StorefrontSettingsRecord {
  id?: string;
  status: string;
  theme: string;
  subdomain?: string | null;
  defaultHostname?: string;
  displayName?: string | null;
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  paymentProvider?: string | null;
  tenantRazorpayKeyId?: string | null;
  hasTenantRazorpaySecret?: boolean;
  deliveryCharge: string;
  freeDeliveryAbove: string;
  allowGuestCheckout: boolean;
  allowCustomerLogin: boolean;
  allowCod: boolean;
}

interface DomainRecord {
  id?: string;
  hostname: string;
  type: string;
  status: string;
  approvedAt?: string | null;
}

interface EcommerceOverview {
  modulePricing: ModulePricingRecord[];
  shops: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    storefront: StorefrontSettingsRecord | null;
    domains: DomainRecord[];
    subscription: { status: string; priceOverride: string | null; billingCycle: string } | null;
    pendingApprovalCount: number;
  }>;
  approvals: Array<{
    id: string;
    type: string;
    payload: unknown;
    notes?: string | null;
    requestedAt: string;
    tenant: { id: string; name: string; slug: string };
  }>;
  metrics: { active: number; requested: number; activeDomains: number; pendingApprovals: number };
  rootDomain: string;
}

interface ModulePricingRecord {
  module: string;
  displayName: string;
  description?: string | null;
  basePrice: string;
  currency: string;
  billingCycle: string;
  isActive: boolean;
  counts?: { active: number; requested: number; suspended: number };
}

interface PlatformOverview {
  modules: ModulePricingRecord[];
  config: Record<string, { configured: boolean; required?: string[]; value?: string }>;
  recentLogs: AuditLogRecord[];
}

interface AuditLogRecord {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  notes: string | null;
  createdAt: string;
  superAdmin: { name: string; email: string };
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

interface LicenseForm {
  plan: string;
  billingCycle: string;
  startDate: string;
  expiryDate: string;
  amountPaid: string;
  paymentRef: string;
  paymentMode: string;
  notes: string;
}

interface StorefrontForm {
  status: string;
  subscriptionStatus: string;
  priceOverride: string;
  billingCycle: string;
  theme: string;
  subdomain: string;
  displayName: string;
  heroTitle: string;
  heroSubtitle: string;
  primaryColor: string;
  accentColor: string;
  allowGuestCheckout: boolean;
  allowCustomerLogin: boolean;
  allowCod: boolean;
  paymentProvider: string;
  tenantRazorpayKeyId: string;
  tenantRazorpayKeySecret: string;
  deliveryCharge: string;
  freeDeliveryAbove: string;
  customDomain: string;
  notes: string;
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

const emptyAdminForm: CreateAdminForm = { name: "", email: "", password: "", role: "SUPPORT" };
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
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [templates, setTemplates] = useState<SystemTemplateRecord[]>([]);
  const [impersonationSessions, setImpersonationSessions] = useState<ImpersonationSessionRecord[]>([]);
  const [ecommerce, setEcommerce] = useState<EcommerceOverview | null>(null);
  const [platform, setPlatform] = useState<PlatformOverview | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [selectedShop, setSelectedShop] = useState<ShopRecord | null>(null);
  const [selectedShopLogs, setSelectedShopLogs] = useState<AuditLogRecord[]>([]);
  const [shopForm, setShopForm] = useState<CreateShopForm>(emptyShopForm);
  const [adminForm, setAdminForm] = useState<CreateAdminForm>(emptyAdminForm);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(emptyTemplateForm);
  const [licenseForm, setLicenseForm] = useState<LicenseForm | null>(null);
  const [storefrontForm, setStorefrontForm] = useState<StorefrontForm | null>(null);
  const [moduleDrafts, setModuleDrafts] = useState<Record<string, { status: string; priceOverride: string; billingCycle: string; notes: string }>>({});
  const [modulePrices, setModulePrices] = useState<Record<string, { basePrice: string; billingCycle: string; isActive: boolean; displayName: string }>>({});
  const [impersonationTarget, setImpersonationTarget] = useState<ShopRecord | null>(null);
  const [impersonationAccessLevel, setImpersonationAccessLevel] = useState<"READ_ONLY" | "WRITE">("READ_ONLY");
  const [impersonationReason, setImpersonationReason] = useState("");
  const [shopSearch, setShopSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = admin.role === "OWNER" || admin.role === "MANAGER";
  const canManageAdmins = admin.role === "OWNER";
  const filteredShops = useMemo(() => {
    const needle = shopSearch.trim().toLowerCase();
    if (!needle) return shops;
    return shops.filter((shop) => [shop.name, shop.slug, shop.phone, shop.vertical].some((value) => value.toLowerCase().includes(needle)));
  }, [shopSearch, shops]);

  const loadData = useCallback(async () => {
    setError(null);
    const [dashboardBody, shopsBody, adminsBody, templatesBody, sessionsBody, ecommerceBody, platformBody, auditBody] = await Promise.all([
      apiGet<{ metrics: DashboardMetrics }>("/superadmin/dashboard"),
      loadAllShops(),
      apiGet<{ admins: AdminRecord[] }>("/superadmin/admins"),
      apiGet<{ templates: SystemTemplateRecord[] }>("/superadmin/templates"),
      apiGet<{ sessions: ImpersonationSessionRecord[] }>("/superadmin/impersonate/sessions?active=true&limit=50"),
      apiGet<EcommerceOverview>("/superadmin/ecommerce"),
      apiGet<PlatformOverview>("/superadmin/platform"),
      apiGet<{ logs: AuditLogRecord[] }>("/superadmin/audit/logs?limit=100"),
    ]);

    setMetrics(dashboardBody.metrics);
    setShops(shopsBody);
    setAdmins(adminsBody.admins);
    setTemplates(templatesBody.templates);
    setImpersonationSessions(sessionsBody.sessions);
    setEcommerce(ecommerceBody);
    setPlatform(platformBody);
    setAuditLogs(auditBody.logs);
    setModulePrices(Object.fromEntries(platformBody.modules.map((item) => [item.module, {
      basePrice: item.basePrice,
      billingCycle: item.billingCycle,
      isActive: item.isActive,
      displayName: item.displayName,
    }])));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData().catch((err: unknown) => {
      setError(readError(err));
      setLoading(false);
    });
  }, [loadData]);

  async function openShop(shop: ShopRecord) {
    setError(null);
    const [detailBody, logsBody] = await Promise.all([
      apiGet<{ shop: ShopRecord }>(`/superadmin/shops/${shop.id}`),
      apiGet<{ logs: AuditLogRecord[] }>(`/superadmin/shops/${shop.id}/logs`),
    ]);
    const detail = detailBody.shop;
    setSelectedShop(detail);
    setSelectedShopLogs(logsBody.logs);
    setLicenseForm(licenseFormFromShop(detail));
    setStorefrontForm(storefrontFormFromShop(detail, ecommerce?.rootDomain ?? "bizbil.com"));
    setModuleDrafts(moduleDraftsFromShop(detail));
  }

  function updateShopField(field: keyof CreateShopForm, value: string) {
    setShopForm((current) => ({ ...current, [field]: value }));
  }

  function updateShopName(value: string) {
    setShopForm((current) => {
      const previousGeneratedSlug = slugify(current.tenantName);
      const shouldAutoUpdateSlug = current.tenantSlug.trim() === "" || current.tenantSlug === previousGeneratedSlug;
      return { ...current, tenantName: value, tenantSlug: shouldAutoUpdateSlug ? slugify(value) : current.tenantSlug };
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
    await apiPost("/superadmin/shops", cleanPayload({ ...shopForm, tenantSlug: normalizedSlug, amountPaid: Number(shopForm.amountPaid || 0) }));
    setShopForm(emptyShopForm);
    setNotice("Shop created");
    await loadData();
  }

  async function saveLicense() {
    if (!selectedShop || !licenseForm) return;
    setError(null);
    await apiPut(`/superadmin/shops/${selectedShop.id}/license`, {
      ...licenseForm,
      amountPaid: Number(licenseForm.amountPaid || 0),
    });
    setNotice("License updated");
    await Promise.all([loadData(), openShop(selectedShop)]);
  }

  async function changeShopStatus(shop: ShopRecord, action: "warning" | "suspend" | "reactivate") {
    setError(null);
    await apiPatch(`/superadmin/shops/${shop.id}/${action}`);
    setNotice(`${shop.name} updated`);
    await loadData();
    if (selectedShop?.id === shop.id) await openShop(shop);
  }

  async function saveModulePricing(module: string) {
    const draft = modulePrices[module];
    if (!draft) return;
    setError(null);
    await apiPut(`/superadmin/ecommerce/pricing/${module}`, {
      displayName: draft.displayName || formatSelectOption(module),
      basePrice: Number(draft.basePrice || 0),
      billingCycle: draft.billingCycle,
      isActive: draft.isActive,
    });
    setNotice(`${formatSelectOption(module)} pricing updated`);
    await loadData();
  }

  async function saveShopModule(module: string) {
    if (!selectedShop) return;
    const draft = moduleDrafts[module];
    if (!draft) return;
    setError(null);
    await apiPut(`/superadmin/shops/${selectedShop.id}/modules/${module}`, cleanPayload({
      status: draft.status,
      priceOverride: draft.priceOverride ? Number(draft.priceOverride) : null,
      billingCycle: draft.billingCycle,
      notes: draft.notes,
    }));
    setNotice(`${formatSelectOption(module)} subscription updated`);
    await Promise.all([loadData(), openShop(selectedShop)]);
  }

  async function saveStorefront() {
    if (!selectedShop || !storefrontForm) return;
    setError(null);
    await apiPut(`/superadmin/ecommerce/shops/${selectedShop.id}`, cleanPayload({
      ...storefrontForm,
      priceOverride: storefrontForm.priceOverride ? Number(storefrontForm.priceOverride) : undefined,
      deliveryCharge: Number(storefrontForm.deliveryCharge || 0),
      freeDeliveryAbove: Number(storefrontForm.freeDeliveryAbove || 0),
      tenantRazorpayKeySecret: storefrontForm.tenantRazorpayKeySecret || undefined,
      customDomain: storefrontForm.customDomain || undefined,
    }));
    setNotice("Storefront settings updated");
    await Promise.all([loadData(), openShop(selectedShop)]);
  }

  async function approveEcommerceRequest(approvalId: string) {
    setError(null);
    await apiPost(`/superadmin/ecommerce/approvals/${approvalId}/approve`, {});
    setNotice("Ecommerce request approved");
    await loadData();
  }

  async function rejectEcommerceRequest(approvalId: string) {
    const reason = window.prompt("Reason for rejection");
    if (!reason?.trim()) return;
    setError(null);
    await apiPost(`/superadmin/ecommerce/approvals/${approvalId}/reject`, { reason });
    setNotice("Ecommerce request rejected");
    await loadData();
  }

  async function createAdmin() {
    setError(null);
    await apiPost("/superadmin/admins", cleanPayload(adminForm));
    setAdminForm(emptyAdminForm);
    setNotice("Super-admin created");
    await loadData();
  }

  async function deactivateAdmin(item: AdminRecord) {
    if (!window.confirm(`Deactivate ${item.email}?`)) return;
    setError(null);
    await apiPatch(`/superadmin/admins/${item.id}/deactivate`);
    setNotice("Super-admin deactivated");
    await loadData();
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
    if (!impersonationTarget) return;
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

  async function logout() {
    await apiPost("/superadmin/auth/logout", {});
    router.replace("/superadmin/login");
  }

  const tabs: Array<{ id: TabId; label: string; icon: typeof Activity }> = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "shops", label: "Shops", icon: Store },
    { id: "modules", label: "Modules", icon: Layers3 },
    { id: "ecommerce", label: "Ecommerce", icon: ShoppingBag },
    { id: "platform", label: "Platform", icon: Settings },
    { id: "templates", label: "Templates", icon: FileText },
    { id: "admins", label: "Admins", icon: Users },
    { id: "audit", label: "Audit", icon: ClipboardList },
  ];

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-slate-200">
              <img src="/bizbil-landing/icons/bizbil-mark.png" alt="BizBil" className="h-full w-full object-contain" />
            </div>
            <div>
              <img src="/bizbil-landing/icons/bizbil-wordmark.png" alt="BizBil" className="h-5 w-auto object-contain" />
              <div className="text-xs text-slate-500">Super Admin / {admin.name} / {admin.role}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700" onClick={() => void loadData()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white" onClick={() => void logout()}>
              <LogOut className="size-4" aria-hidden="true" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-65px)] lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-slate-200 bg-white p-3 lg:border-b-0 lg:border-r">
          <nav className="grid gap-1">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  className={`flex h-10 items-center gap-3 rounded-md px-3 text-left text-sm font-medium ${active ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50"}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0 p-4 sm:p-5">
          {notice ? <Notice tone="success" text={notice} /> : null}
          {error ? <Notice tone="error" text={error} /> : null}

          {activeTab === "overview" ? (
            <Overview metrics={metrics} ecommerce={ecommerce} platform={platform} sessions={impersonationSessions} logs={auditLogs} loading={loading} />
          ) : null}
          {activeTab === "shops" ? (
            <ShopsPanel
              shops={filteredShops}
              shopSearch={shopSearch}
              setShopSearch={setShopSearch}
              shopForm={shopForm}
              updateShopField={updateShopField}
              updateShopName={updateShopName}
              createShop={() => void createShop().catch((err: unknown) => setError(readError(err)))}
              canManage={canManage}
              openShop={(shop) => void openShop(shop).catch((err: unknown) => setError(readError(err)))}
              changeShopStatus={(shop, action) => void changeShopStatus(shop, action).catch((err: unknown) => setError(readError(err)))}
              openImpersonationDialog={openImpersonationDialog}
            />
          ) : null}
          {activeTab === "modules" ? (
            <ModulesPanel platform={platform} modulePrices={modulePrices} setModulePrices={setModulePrices} saveModulePricing={(module) => void saveModulePricing(module).catch((err: unknown) => setError(readError(err)))} canManage={canManage} />
          ) : null}
          {activeTab === "ecommerce" ? (
            <EcommercePanel ecommerce={ecommerce} canManage={canManage} onApprove={(id) => void approveEcommerceRequest(id).catch((err: unknown) => setError(readError(err)))} onReject={(id) => void rejectEcommerceRequest(id).catch((err: unknown) => setError(readError(err)))} openShop={(shopId) => {
              const shop = shops.find((item) => item.id === shopId);
              if (shop) void openShop(shop).catch((err: unknown) => setError(readError(err)));
            }} />
          ) : null}
          {activeTab === "platform" ? <PlatformPanel platform={platform} /> : null}
          {activeTab === "templates" ? (
            <TemplatesPanel templates={templates} templateForm={templateForm} setTemplateForm={setTemplateForm} selectTemplate={selectTemplate} saveTemplate={() => void saveTemplate().catch((err: unknown) => setError(readError(err)))} canManage={canManage} />
          ) : null}
          {activeTab === "admins" ? (
            <AdminsPanel admins={admins} adminForm={adminForm} setAdminForm={setAdminForm} createAdmin={() => void createAdmin().catch((err: unknown) => setError(readError(err)))} deactivateAdmin={(item) => void deactivateAdmin(item).catch((err: unknown) => setError(readError(err)))} canManageAdmins={canManageAdmins} />
          ) : null}
          {activeTab === "audit" ? <AuditPanel logs={auditLogs} sessions={impersonationSessions} forceEnd={(session) => void forceEndImpersonation(session).catch((err: unknown) => setError(readError(err)))} canManage={canManage} /> : null}
        </section>
      </div>

      {selectedShop ? (
        <ShopDrawer
          shop={selectedShop}
          logs={selectedShopLogs}
          licenseForm={licenseForm}
          setLicenseForm={setLicenseForm}
          storefrontForm={storefrontForm}
          setStorefrontForm={setStorefrontForm}
          moduleDrafts={moduleDrafts}
          setModuleDrafts={setModuleDrafts}
          canManage={canManage}
          close={() => setSelectedShop(null)}
          saveLicense={() => void saveLicense().catch((err: unknown) => setError(readError(err)))}
          saveStorefront={() => void saveStorefront().catch((err: unknown) => setError(readError(err)))}
          saveShopModule={(module) => void saveShopModule(module).catch((err: unknown) => setError(readError(err)))}
          pushTemplate={(shop) => void pushSelectedTemplate(shop).catch((err: unknown) => setError(readError(err)))}
          openImpersonationDialog={openImpersonationDialog}
        />
      ) : null}

      {impersonationTarget ? (
        <ImpersonationDialog
          shop={impersonationTarget}
          canManage={canManage}
          accessLevel={impersonationAccessLevel}
          setAccessLevel={setImpersonationAccessLevel}
          reason={impersonationReason}
          setReason={setImpersonationReason}
          close={() => setImpersonationTarget(null)}
          start={() => void startImpersonation().catch((err: unknown) => setError(readError(err)))}
        />
      ) : null}
    </main>
  );
}

function Overview({ metrics, ecommerce, platform, sessions, logs, loading }: Readonly<{ metrics: DashboardMetrics | null; ecommerce: EcommerceOverview | null; platform: PlatformOverview | null; sessions: ImpersonationSessionRecord[]; logs: AuditLogRecord[]; loading: boolean }>) {
  return (
    <div className="space-y-5">
      <SectionHeader title="Control Center" subtitle="Operational status, pending approvals, and platform readiness." />
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <SummaryStat label="Shops" value={loading ? "-" : `${String(metrics?.activeShops ?? 0)}/${String(metrics?.totalShops ?? 0)}`} detail={`${String(metrics?.warningShops ?? 0)} warning / ${String(metrics?.suspendedShops ?? 0)} suspended`} />
          <SummaryStat label="Revenue" value={`Rs ${metrics?.revenue ?? "0"}`} detail={`${String(metrics?.expiringLicenses ?? 0)} expiring licenses`} />
          <SummaryStat label="Ecommerce" value={`${String(ecommerce?.metrics.active ?? 0)} active`} detail={`${String(ecommerce?.metrics.pendingApprovals ?? 0)} approvals / ${String(ecommerce?.metrics.activeDomains ?? 0)} domains`} />
          <SummaryStat label="Support" value={`${String(sessions.length)} active`} detail="Impersonation sessions" />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <Panel title="Platform Readiness">
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(platform?.config ?? {}).map(([key, item]) => <ConfigRow key={key} name={formatSelectOption(key)} item={item} />)}
          </div>
        </Panel>
        <Panel title="Recent Admin Activity">
          <LogList logs={logs.slice(0, 8)} />
        </Panel>
      </div>
    </div>
  );
}

function ShopsPanel(props: Readonly<{
  shops: ShopRecord[];
  shopSearch: string;
  setShopSearch: (value: string) => void;
  shopForm: CreateShopForm;
  updateShopField: (field: keyof CreateShopForm, value: string) => void;
  updateShopName: (value: string) => void;
  createShop: () => void;
  canManage: boolean;
  openShop: (shop: ShopRecord) => void;
  changeShopStatus: (shop: ShopRecord, action: "warning" | "suspend" | "reactivate") => void;
  openImpersonationDialog: (shop: ShopRecord) => void;
}>) {
  const shopSlugExists = props.shopForm.tenantSlug.trim() !== "" && props.shops.some((shop) => shop.slug === props.shopForm.tenantSlug.trim().toLowerCase());
  return (
    <div className="space-y-5">
      <SectionHeader title="Shops" subtitle="Create shops, inspect tenant health, update status, licenses, modules, and logs." />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Panel title="Shop Directory" action={<SearchBox value={props.shopSearch} onChange={props.setShopSearch} />}>
          <DataTable headers={["Shop", "Status", "License", "Usage", "Actions"]}>
            {props.shops.map((shop) => (
              <tr key={shop.id} className="border-t border-slate-100">
                <td className="px-3 py-3">
                  <button className="text-left font-semibold text-slate-950 hover:text-emerald-700" onClick={() => props.openShop(shop)}>{shop.name}</button>
                  <div className="text-xs text-slate-500">{shop.slug} / {shop.vertical} / {shop.phone}</div>
                </td>
                <td className="px-3 py-3"><StatusPill status={shop.status} /></td>
                <td className="px-3 py-3 text-sm">
                  <div>{shop.license?.plan ?? "No license"}</div>
                  <div className="text-xs text-slate-500">{shop.license ? formatDate(shop.license.expiryDate) : "-"}</div>
                </td>
                <td className="px-3 py-3 text-sm text-slate-600">{shop._count?.products ?? 0} products / {shop._count?.invoices ?? 0} bills</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <SmallButton onClick={() => props.openShop(shop)}>Manage</SmallButton>
                    <SmallButton onClick={() => props.openImpersonationDialog(shop)} disabled={shop.status === "SUSPENDED"}>View as shop</SmallButton>
                    <SmallButton onClick={() => props.changeShopStatus(shop, "warning")} disabled={!props.canManage}>Warn</SmallButton>
                    <SmallButton tone="danger" onClick={() => props.changeShopStatus(shop, "suspend")} disabled={!props.canManage}>Suspend</SmallButton>
                    <SmallButton tone="success" onClick={() => props.changeShopStatus(shop, "reactivate")} disabled={!props.canManage}>Active</SmallButton>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel title="Create Shop">
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); props.createShop(); }}>
            <TextInput label="Shop name" value={props.shopForm.tenantName} onChange={props.updateShopName} required />
            <TextInput label="Shop slug" value={props.shopForm.tenantSlug} onChange={(value) => props.updateShopField("tenantSlug", value)} required />
            {shopSlugExists ? <div className="text-xs font-medium text-red-700">This shop slug is already used.</div> : null}
            <SelectInput label="Vertical" value={props.shopForm.vertical} options={verticals} onChange={(value) => props.updateShopField("vertical", value)} />
            <TextInput label="Phone" value={props.shopForm.phone} onChange={(value) => props.updateShopField("phone", value)} required />
            <TextInput label="Owner name" value={props.shopForm.ownerName} onChange={(value) => props.updateShopField("ownerName", value)} required />
            <TextInput label="Owner email" type="email" value={props.shopForm.ownerEmail} onChange={(value) => props.updateShopField("ownerEmail", value)} required />
            <TextInput label="Owner username" value={props.shopForm.ownerUsername} onChange={(value) => props.updateShopField("ownerUsername", value)} />
            <TextInput label="Owner password" type="password" value={props.shopForm.ownerPassword} onChange={(value) => props.updateShopField("ownerPassword", value)} minLength={8} required />
            <SelectInput label="Plan" value={props.shopForm.plan} options={plans} onChange={(value) => props.updateShopField("plan", value)} />
            <SelectInput label="Billing cycle" value={props.shopForm.billingCycle} options={cycles} onChange={(value) => props.updateShopField("billingCycle", value)} />
            <TextInput label="Amount paid" type="number" value={props.shopForm.amountPaid} onChange={(value) => props.updateShopField("amountPaid", value)} />
            <PrimaryButton disabled={!props.canManage || shopSlugExists}>Create shop</PrimaryButton>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function ModulesPanel({ platform, modulePrices, setModulePrices, saveModulePricing, canManage }: Readonly<{ platform: PlatformOverview | null; modulePrices: Record<string, { basePrice: string; billingCycle: string; isActive: boolean; displayName: string }>; setModulePrices: (value: Record<string, { basePrice: string; billingCycle: string; isActive: boolean; displayName: string }>) => void; saveModulePricing: (module: string) => void; canManage: boolean }>) {
  return (
    <div className="space-y-5">
      <SectionHeader title="Modules & Pricing" subtitle="Control module availability and default prices for all tenants." />
      <Panel title="Platform Modules">
        <div className="grid gap-3">
          {(platform?.modules ?? modules.map((module) => ({ module, displayName: formatSelectOption(module), basePrice: "0", billingCycle: "MONTHLY", isActive: true, currency: "INR", counts: { active: 0, requested: 0, suspended: 0 } }))).map((item) => {
            const draft = modulePrices[item.module] ?? { basePrice: item.basePrice, billingCycle: item.billingCycle, isActive: item.isActive, displayName: item.displayName };
            return (
              <div key={item.module} className="grid gap-3 rounded-md border border-slate-200 p-3 lg:grid-cols-[1fr_160px_180px_120px_auto]">
                <div>
                  <input className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold" value={draft.displayName} onChange={(event) => setModulePrices({ ...modulePrices, [item.module]: { ...draft, displayName: event.target.value } })} />
                  <div className="mt-1 text-xs text-slate-500">{item.counts?.active ?? 0} active / {item.counts?.requested ?? 0} requested / {item.counts?.suspended ?? 0} suspended</div>
                </div>
                <TextInput compact label="Price" type="number" value={draft.basePrice} onChange={(value) => setModulePrices({ ...modulePrices, [item.module]: { ...draft, basePrice: value } })} />
                <SelectInput compact label="Cycle" value={draft.billingCycle} options={cycles} onChange={(value) => setModulePrices({ ...modulePrices, [item.module]: { ...draft, billingCycle: value } })} />
                <Toggle label="Active" checked={draft.isActive} onChange={(checked) => setModulePrices({ ...modulePrices, [item.module]: { ...draft, isActive: checked } })} />
                <SmallButton tone="success" disabled={!canManage} onClick={() => saveModulePricing(item.module)}>Save</SmallButton>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function EcommercePanel({ ecommerce, canManage, onApprove, onReject, openShop }: Readonly<{ ecommerce: EcommerceOverview | null; canManage: boolean; onApprove: (id: string) => void; onReject: (id: string) => void; openShop: (shopId: string) => void }>) {
  return (
    <div className="space-y-5">
      <SectionHeader title="Ecommerce" subtitle="Approve requests and manage tenant storefronts from each shop drawer." />
      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel title="Pending Approvals">
          {(ecommerce?.approvals ?? []).length === 0 ? <EmptyState text="No pending ecommerce approvals." /> : (
            <div className="grid gap-3">
              {(ecommerce?.approvals ?? []).map((approval) => (
                <div key={approval.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{approval.tenant.name}</div>
                      <div className="text-xs text-slate-500">{formatSelectOption(approval.type)} / {approval.tenant.slug} / {formatDateTime(approval.requestedAt)}</div>
                      {approval.notes ? <div className="mt-2 text-sm text-slate-600">{approval.notes}</div> : null}
                    </div>
                    <div className="flex gap-2">
                      <SmallButton tone="success" disabled={!canManage} onClick={() => onApprove(approval.id)}>Approve</SmallButton>
                      <SmallButton tone="danger" disabled={!canManage} onClick={() => onReject(approval.id)}>Reject</SmallButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Storefronts">
          <DataTable headers={["Shop", "Storefront", "Domain", "Payments", "Actions"]}>
            {(ecommerce?.shops ?? []).map((shop) => (
              <tr key={shop.id} className="border-t border-slate-100">
                <td className="px-3 py-3 font-semibold">{shop.name}<div className="text-xs font-normal text-slate-500">{shop.slug}</div></td>
                <td className="px-3 py-3"><StatusPill status={shop.storefront?.status ?? "DISABLED"} /><div className="mt-1 text-xs text-slate-500">{shop.storefront?.theme ?? "No theme"}</div></td>
                <td className="px-3 py-3 text-sm">{shop.storefront?.defaultHostname ?? "-"}<div className="text-xs text-slate-500">{shop.domains.filter((domain) => domain.status === "ACTIVE").length} active domains</div></td>
                <td className="px-3 py-3 text-sm">{shop.storefront?.paymentProvider ?? "Not set"}<div className="text-xs text-slate-500">{shop.storefront?.hasTenantRazorpaySecret ? "Tenant secret saved" : "No tenant secret"}</div></td>
                <td className="px-3 py-3"><SmallButton onClick={() => openShop(shop.id)}>Manage</SmallButton></td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    </div>
  );
}

function PlatformPanel({ platform }: Readonly<{ platform: PlatformOverview | null }>) {
  return (
    <div className="space-y-5">
      <SectionHeader title="Platform Settings" subtitle="Server-level readiness without exposing secrets." />
      <Panel title="Configuration Status">
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(platform?.config ?? {}).map(([key, item]) => <ConfigRow key={key} name={formatSelectOption(key)} item={item} />)}
        </div>
      </Panel>
      <Panel title="Recent Platform Changes">
        <LogList logs={platform?.recentLogs ?? []} />
      </Panel>
    </div>
  );
}

function TemplatesPanel({ templates, templateForm, setTemplateForm, selectTemplate, saveTemplate, canManage }: Readonly<{ templates: SystemTemplateRecord[]; templateForm: TemplateForm; setTemplateForm: (value: TemplateForm) => void; selectTemplate: (template: SystemTemplateRecord) => void; saveTemplate: () => void; canManage: boolean }>) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="System Templates">
        <div className="divide-y divide-slate-100">
          {templates.map((template) => (
            <button key={template.id} className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm" onClick={() => selectTemplate(template)}>
              <div><div className="font-semibold">{template.name}</div><div className="text-slate-500">{template.description ?? "No description"}</div></div>
              <div className="text-right text-xs text-slate-500"><div>{template.paperSize}</div><div>{template.renderType} / v{template.version}</div></div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={templateForm.id ? "Edit Template" : "Create Template"}>
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); saveTemplate(); }}>
          <TextInput label="Template name" value={templateForm.name} onChange={(value) => setTemplateForm({ ...templateForm, name: value })} required />
          <TextInput label="Description" value={templateForm.description} onChange={(value) => setTemplateForm({ ...templateForm, description: value })} />
          <SelectInput label="Paper size" value={templateForm.paperSize} options={paperSizes} onChange={(value) => setTemplateForm({ ...templateForm, paperSize: value })} />
          <SelectInput label="Render type" value={templateForm.renderType} options={renderTypes} onChange={(value) => setTemplateForm({ ...templateForm, renderType: value })} />
          <TextAreaInput label="ESC/POS JSON" value={templateForm.escposConfig} onChange={(value) => setTemplateForm({ ...templateForm, escposConfig: value })} />
          <TextAreaInput label="UI config JSON" value={templateForm.uiConfig} onChange={(value) => setTemplateForm({ ...templateForm, uiConfig: value })} />
          <TextAreaInput label="HTML source" value={templateForm.htmlSource} onChange={(value) => setTemplateForm({ ...templateForm, htmlSource: value })} tall />
          <div className="flex gap-2"><PrimaryButton disabled={!canManage}>Save template</PrimaryButton><SmallButton onClick={() => setTemplateForm(emptyTemplateForm)}>Clear</SmallButton></div>
        </form>
      </Panel>
    </div>
  );
}

function AdminsPanel({ admins, adminForm, setAdminForm, createAdmin, deactivateAdmin, canManageAdmins }: Readonly<{ admins: AdminRecord[]; adminForm: CreateAdminForm; setAdminForm: (value: CreateAdminForm) => void; createAdmin: () => void; deactivateAdmin: (admin: AdminRecord) => void; canManageAdmins: boolean }>) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Panel title="Super Admins">
        <DataTable headers={["Admin", "Role", "Status", "Actions"]}>
          {admins.map((item) => (
            <tr key={item.id} className="border-t border-slate-100">
              <td className="px-3 py-3"><div className="font-semibold">{item.name}</div><div className="text-xs text-slate-500">{item.email}</div></td>
              <td className="px-3 py-3">{item.role}</td>
              <td className="px-3 py-3"><StatusPill status={item.isActive ? "ACTIVE" : "SUSPENDED"} /></td>
              <td className="px-3 py-3"><SmallButton tone="danger" disabled={!canManageAdmins || !item.isActive} onClick={() => deactivateAdmin(item)}>Deactivate</SmallButton></td>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <Panel title="Create Super Admin">
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); createAdmin(); }}>
          <TextInput label="Name" value={adminForm.name} onChange={(value) => setAdminForm({ ...adminForm, name: value })} required />
          <TextInput label="Email" type="email" value={adminForm.email} onChange={(value) => setAdminForm({ ...adminForm, email: value })} required />
          <TextInput label="Password" type="password" value={adminForm.password} onChange={(value) => setAdminForm({ ...adminForm, password: value })} required />
          <SelectInput label="Role" value={adminForm.role} options={adminRoles} onChange={(value) => setAdminForm({ ...adminForm, role: value })} />
          <PrimaryButton disabled={!canManageAdmins}>Create admin</PrimaryButton>
        </form>
      </Panel>
    </div>
  );
}

function AuditPanel({ logs, sessions, forceEnd, canManage }: Readonly<{ logs: AuditLogRecord[]; sessions: ImpersonationSessionRecord[]; forceEnd: (session: ImpersonationSessionRecord) => void; canManage: boolean }>) {
  return (
    <div className="space-y-5">
      <SectionHeader title="Audit & Sessions" subtitle="Review admin actions and active support access." />
      <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <Panel title="Audit Logs"><LogList logs={logs} /></Panel>
        <Panel title="Active Support Sessions">
          {sessions.length === 0 ? <EmptyState text="No active support sessions." /> : (
            <div className="grid gap-3">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-md border border-slate-200 p-3 text-sm">
                  <div className="font-semibold">{session.tenant.name}</div>
                  <div className="text-xs text-slate-500">{session.superAdmin.email} / {session.accessLevel} / expires {formatDateTime(session.expiresAt)}</div>
                  <div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-500">{session.actionsCount} writes</span><SmallButton tone="danger" disabled={!canManage} onClick={() => forceEnd(session)}>Force end</SmallButton></div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ShopDrawer(props: Readonly<{
  shop: ShopRecord;
  logs: AuditLogRecord[];
  licenseForm: LicenseForm | null;
  setLicenseForm: (value: LicenseForm) => void;
  storefrontForm: StorefrontForm | null;
  setStorefrontForm: (value: StorefrontForm) => void;
  moduleDrafts: Record<string, { status: string; priceOverride: string; billingCycle: string; notes: string }>;
  setModuleDrafts: (value: Record<string, { status: string; priceOverride: string; billingCycle: string; notes: string }>) => void;
  canManage: boolean;
  close: () => void;
  saveLicense: () => void;
  saveStorefront: () => void;
  saveShopModule: (module: string) => void;
  pushTemplate: (shop: ShopRecord) => void;
  openImpersonationDialog: (shop: ShopRecord) => void;
}>) {
  const licenseForm = props.licenseForm;
  const storefrontForm = props.storefrontForm;

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/40">
      <div className="ml-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div><div className="text-xl font-bold">{props.shop.name}</div><div className="text-sm text-slate-500">{props.shop.slug} / {props.shop.vertical} / {props.shop.phone}</div></div>
          <button className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200" onClick={props.close} aria-label="Close shop drawer"><X className="size-4" aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="License">
              {licenseForm ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <SelectInput label="Plan" value={licenseForm.plan} options={plans} onChange={(value) => props.setLicenseForm({ ...licenseForm, plan: value })} />
                  <SelectInput label="Billing cycle" value={licenseForm.billingCycle} options={cycles} onChange={(value) => props.setLicenseForm({ ...licenseForm, billingCycle: value })} />
                  <TextInput label="Start date" type="date" value={licenseForm.startDate} onChange={(value) => props.setLicenseForm({ ...licenseForm, startDate: value })} />
                  <TextInput label="Expiry date" type="date" value={licenseForm.expiryDate} onChange={(value) => props.setLicenseForm({ ...licenseForm, expiryDate: value })} />
                  <TextInput label="Amount paid" type="number" value={licenseForm.amountPaid} onChange={(value) => props.setLicenseForm({ ...licenseForm, amountPaid: value })} />
                  <TextInput label="Payment ref" value={licenseForm.paymentRef} onChange={(value) => props.setLicenseForm({ ...licenseForm, paymentRef: value })} />
                  <TextInput label="Payment mode" value={licenseForm.paymentMode} onChange={(value) => props.setLicenseForm({ ...licenseForm, paymentMode: value })} />
                  <TextInput label="Notes" value={licenseForm.notes} onChange={(value) => props.setLicenseForm({ ...licenseForm, notes: value })} />
                  <div className="md:col-span-2"><PrimaryButton disabled={!props.canManage} onClick={props.saveLicense}>Save license</PrimaryButton></div>
                </div>
              ) : <EmptyState text="License is not configured." />}
            </Panel>

            <Panel title="Shop Actions">
              <div className="flex flex-wrap gap-2">
                <SmallButton onClick={() => props.openImpersonationDialog(props.shop)} disabled={props.shop.status === "SUSPENDED"}>View as shop</SmallButton>
                <SmallButton onClick={() => props.pushTemplate(props.shop)} disabled={!props.canManage}>Push selected template</SmallButton>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <SummaryStat label="Users" value={String(props.shop._count?.users ?? props.shop.users?.length ?? 0)} />
                <SummaryStat label="Products" value={String(props.shop._count?.products ?? 0)} />
                <SummaryStat label="Customers" value={String(props.shop._count?.customers ?? 0)} />
                <SummaryStat label="Deliveries" value={String(props.shop._count?.deliveries ?? 0)} />
              </div>
            </Panel>

            <Panel title="Module Subscriptions">
              <div className="grid gap-3">
                {modules.map((module) => {
                  const draft = props.moduleDrafts[module] ?? { status: "DISABLED", priceOverride: "", billingCycle: "MONTHLY", notes: "" };
                  return (
                    <div key={module} className="rounded-md border border-slate-200 p-3">
                      <div className="mb-2 font-semibold">{formatSelectOption(module)}</div>
                      <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                        <SelectInput compact label="Status" value={draft.status} options={subscriptionStatuses} onChange={(value) => props.setModuleDrafts({ ...props.moduleDrafts, [module]: { ...draft, status: value } })} />
                        <TextInput compact label="Override" type="number" value={draft.priceOverride} onChange={(value) => props.setModuleDrafts({ ...props.moduleDrafts, [module]: { ...draft, priceOverride: value } })} />
                        <SelectInput compact label="Cycle" value={draft.billingCycle} options={cycles} onChange={(value) => props.setModuleDrafts({ ...props.moduleDrafts, [module]: { ...draft, billingCycle: value } })} />
                        <SmallButton tone="success" disabled={!props.canManage} onClick={() => props.saveShopModule(module)}>Save</SmallButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Ecommerce Storefront">
              {storefrontForm ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <SelectInput label="Storefront status" value={storefrontForm.status} options={storefrontStatuses} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, status: value, subscriptionStatus: value === "ACTIVE" ? "ACTIVE" : value === "SUSPENDED" ? "SUSPENDED" : "DISABLED" })} />
                  <SelectInput label="Theme" value={storefrontForm.theme} options={storefrontThemes} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, theme: value })} />
                  <TextInput label="Subdomain" value={storefrontForm.subdomain} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, subdomain: value })} />
                  <TextInput label="Custom domain" value={storefrontForm.customDomain} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, customDomain: value })} />
                  <TextInput label="Display name" value={storefrontForm.displayName} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, displayName: value })} />
                  <TextInput label="Hero title" value={storefrontForm.heroTitle} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, heroTitle: value })} />
                  <TextInput label="Hero subtitle" value={storefrontForm.heroSubtitle} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, heroSubtitle: value })} />
                  <SelectInput label="Payment provider" value={storefrontForm.paymentProvider} options={paymentProviders} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, paymentProvider: value })} />
                  <TextInput label="Tenant Razorpay key ID" value={storefrontForm.tenantRazorpayKeyId} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, tenantRazorpayKeyId: value })} />
                  <TextInput label="Tenant Razorpay secret" type="password" value={storefrontForm.tenantRazorpayKeySecret} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, tenantRazorpayKeySecret: value })} />
                  <TextInput label="Delivery charge" type="number" value={storefrontForm.deliveryCharge} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, deliveryCharge: value })} />
                  <TextInput label="Free delivery above" type="number" value={storefrontForm.freeDeliveryAbove} onChange={(value) => props.setStorefrontForm({ ...storefrontForm, freeDeliveryAbove: value })} />
                  <Toggle label="Guest checkout" checked={storefrontForm.allowGuestCheckout} onChange={(checked) => props.setStorefrontForm({ ...storefrontForm, allowGuestCheckout: checked })} />
                  <Toggle label="Customer login" checked={storefrontForm.allowCustomerLogin} onChange={(checked) => props.setStorefrontForm({ ...storefrontForm, allowCustomerLogin: checked })} />
                  <Toggle label="COD" checked={storefrontForm.allowCod} onChange={(checked) => props.setStorefrontForm({ ...storefrontForm, allowCod: checked })} />
                  <div className="md:col-span-2"><PrimaryButton disabled={!props.canManage} onClick={props.saveStorefront}>Save storefront</PrimaryButton></div>
                </div>
              ) : <EmptyState text="Storefront form could not be loaded." />}
            </Panel>

            <Panel title="Users">
              <DataTable headers={["Name", "Role", "Status"]}>
                {(props.shop.users ?? []).map((user) => (
                  <tr key={user.id} className="border-t border-slate-100">
                    <td className="px-3 py-2"><div className="font-medium">{user.name}</div><div className="text-xs text-slate-500">{user.email} / {user.username ?? "-"}</div></td>
                    <td className="px-3 py-2">{user.role}</td>
                    <td className="px-3 py-2"><StatusPill status={user.isActive ? "ACTIVE" : "SUSPENDED"} /></td>
                  </tr>
                ))}
              </DataTable>
            </Panel>

            <Panel title="Shop Audit">
              <LogList logs={props.logs} />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpersonationDialog(props: Readonly<{ shop: ShopRecord; canManage: boolean; accessLevel: "READ_ONLY" | "WRITE"; setAccessLevel: (value: "READ_ONLY" | "WRITE") => void; reason: string; setReason: (value: string) => void; close: () => void; start: () => void }>) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-lg font-semibold">View as shop</div><div className="text-sm text-slate-500">Start a two-hour support session for {props.shop.name}.</div></div>
          <button className="rounded-md border border-slate-200 px-2 py-1 text-xs" onClick={props.close}>Close</button>
        </div>
        <div className="mt-4 grid gap-3">
          <SelectInput label="Access level" value={props.accessLevel} options={props.canManage ? ["READ_ONLY", "WRITE"] : ["READ_ONLY"]} onChange={(value) => props.setAccessLevel(value as "READ_ONLY" | "WRITE")} />
          <TextAreaInput label={props.accessLevel === "WRITE" ? "Reason (required for write mode)" : "Reason"} value={props.reason} onChange={props.setReason} />
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Read-only mode blocks shop writes. Write mode requires a reason.</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <SmallButton onClick={props.close}>Cancel</SmallButton>
          <PrimaryButton disabled={props.accessLevel === "WRITE" && props.reason.trim().length < 10} onClick={props.start}>Start support view</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: Readonly<{ title: string; subtitle: string }>) {
  return <div><h1 className="text-2xl font-bold tracking-normal text-slate-950">{title}</h1><p className="mt-1 text-sm text-slate-600">{subtitle}</p></div>;
}

function Panel({ title, action, children }: Readonly<{ title: string; action?: React.ReactNode; children: React.ReactNode }>) {
  return <section className="rounded-md border border-slate-200 bg-white"><div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3"><h2 className="font-semibold">{title}</h2>{action}</div><div className="p-4">{children}</div></section>;
}

function SummaryStat({ label, value, detail }: Readonly<{ label: string; value: string; detail?: string }>) {
  return <div><div className="text-xs font-semibold uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>{detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}</div>;
}

function Notice({ tone, text }: Readonly<{ tone: "success" | "error"; text: string }>) {
  const cls = tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800";
  return <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${cls}`}>{text}</div>;
}

function DataTable({ headers, children }: Readonly<{ headers: string[]; children: React.ReactNode }>) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-semibold">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

function StatusPill({ status }: Readonly<{ status: string }>) {
  const base = "inline-flex rounded-md px-2 py-1 text-xs font-semibold";
  if (status === "ACTIVE") return <span className={`${base} bg-emerald-50 text-emerald-700`}>{status}</span>;
  if (status === "REQUESTED" || status === "WARNING") return <span className={`${base} bg-amber-50 text-amber-700`}>{status}</span>;
  if (status === "SUSPENDED") return <span className={`${base} bg-red-50 text-red-700`}>{status}</span>;
  return <span className={`${base} bg-slate-100 text-slate-700`}>{status}</span>;
}

function SearchBox({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  return <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input className="h-9 w-72 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search shops" /></label>;
}

function SmallButton({ children, onClick, disabled, tone = "neutral" }: Readonly<{ children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: "neutral" | "success" | "danger" }>) {
  const cls = tone === "success" ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : tone === "danger" ? "border-red-200 text-red-700 hover:bg-red-50" : "border-slate-200 text-slate-700 hover:bg-slate-50";
  return <button type="button" className={`inline-flex h-8 items-center justify-center rounded-md border bg-white px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${cls}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

function PrimaryButton({ children, onClick, disabled }: Readonly<{ children: React.ReactNode; onClick?: () => void; disabled?: boolean }>) {
  return <button type={onClick ? "button" : "submit"} className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={disabled} onClick={onClick}>{children}</button>;
}

function TextInput({ label, value, onChange, required, minLength, type = "text", compact }: Readonly<{ label: string; value: string; onChange: (value: string) => void; required?: boolean; minLength?: number; type?: "date" | "email" | "number" | "password" | "text"; compact?: boolean }>) {
  return <label className={`block font-medium text-slate-700 ${compact ? "text-xs" : "text-sm"}`}>{label}<input className={`${compact ? "mt-1 h-8" : "mt-1 h-10"} w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-500`} type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} minLength={minLength} /></label>;
}

function SelectInput({ label, value, options, onChange, compact }: Readonly<{ label: string; value: string; options: readonly string[]; onChange: (value: string) => void; compact?: boolean }>) {
  return <label className={`block font-medium text-slate-700 ${compact ? "text-xs" : "text-sm"}`}>{label}<select className={`${compact ? "mt-1 h-8" : "mt-1 h-10"} w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-emerald-500`} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{formatSelectOption(option)}</option>)}</select></label>;
}

function TextAreaInput({ label, value, onChange, tall }: Readonly<{ label: string; value: string; onChange: (value: string) => void; tall?: boolean }>) {
  return <label className="block text-sm font-medium text-slate-700">{label}<textarea className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-950 outline-none focus:border-emerald-500" value={value} rows={tall ? 8 : 4} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Toggle({ label, checked, onChange }: Readonly<{ label: string; checked: boolean; onChange: (checked: boolean) => void }>) {
  return <button type="button" role="switch" aria-checked={checked} className="flex h-10 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700" onClick={() => onChange(!checked)}><span>{label}</span><span className={`relative inline-flex h-5 w-9 items-center rounded-full ${checked ? "bg-emerald-500" : "bg-slate-300"}`}><span className={`size-4 rounded-full bg-white shadow-sm transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} /></span></button>;
}

function ConfigRow({ name, item }: Readonly<{ name: string; item: { configured: boolean; required?: string[]; value?: string } }>) {
  return <div className="rounded-md border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><div className="font-semibold">{name}</div><StatusPill status={item.configured ? "ACTIVE" : "DISABLED"} /></div>{item.value ? <div className="mt-2 text-sm text-slate-600">{item.value}</div> : null}{item.required?.length ? <div className="mt-2 text-xs text-slate-500">Required: {item.required.join(", ")}</div> : null}</div>;
}

function LogList({ logs }: Readonly<{ logs: AuditLogRecord[] }>) {
  if (logs.length === 0) return <EmptyState text="No audit logs found." />;
  return <div className="divide-y divide-slate-100">{logs.map((log) => <div key={log.id} className="py-3 text-sm"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{formatSelectOption(log.action)}</div><div className="text-xs text-slate-500">{log.superAdmin.email} / {log.targetType ?? "system"} / {log.targetId ?? "-"}</div>{log.notes ? <div className="mt-1 text-slate-600">{log.notes}</div> : null}</div><div className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(log.createdAt)}</div></div></div>)}</div>;
}

function EmptyState({ text }: Readonly<{ text: string }>) {
  return <div className="rounded-md border border-dashed border-slate-200 p-5 text-sm text-slate-500">{text}</div>;
}

function licenseFormFromShop(shop: ShopRecord): LicenseForm {
  return {
    plan: shop.license?.plan ?? "STARTER",
    billingCycle: shop.license?.billingCycle ?? "YEARLY",
    startDate: dateInputValue(shop.license?.startDate) || dateInputValue(new Date().toISOString()),
    expiryDate: dateInputValue(shop.license?.expiryDate) || dateInputValue(new Date().toISOString()),
    amountPaid: shop.license?.amountPaid ?? "0",
    paymentRef: shop.license?.paymentRef ?? "",
    paymentMode: shop.license?.paymentMode ?? "",
    notes: shop.license?.notes ?? "",
  };
}

function storefrontFormFromShop(shop: ShopRecord, rootDomain: string): StorefrontForm {
  const settings = shop.storefrontSettings;
  return {
    status: settings?.status ?? "DISABLED",
    subscriptionStatus: settings?.status === "ACTIVE" ? "ACTIVE" : settings?.status === "SUSPENDED" ? "SUSPENDED" : "DISABLED",
    priceOverride: shop.moduleSubscriptions?.find((item) => item.module === "ECOMMERCE")?.priceOverride ?? "",
    billingCycle: shop.moduleSubscriptions?.find((item) => item.module === "ECOMMERCE")?.billingCycle ?? "MONTHLY",
    theme: settings?.theme ?? "CLASSIC_RETAIL",
    subdomain: settings?.subdomain ?? shop.slug,
    displayName: settings?.displayName ?? shop.name,
    heroTitle: settings?.heroTitle ?? shop.name,
    heroSubtitle: settings?.heroSubtitle ?? "Order online from your local store",
    primaryColor: settings?.primaryColor ?? "",
    accentColor: settings?.accentColor ?? "",
    allowGuestCheckout: settings?.allowGuestCheckout ?? true,
    allowCustomerLogin: settings?.allowCustomerLogin ?? true,
    allowCod: settings?.allowCod ?? true,
    paymentProvider: settings?.paymentProvider ?? "PLATFORM_RAZORPAY",
    tenantRazorpayKeyId: settings?.tenantRazorpayKeyId ?? "",
    tenantRazorpayKeySecret: "",
    deliveryCharge: settings?.deliveryCharge ?? "0",
    freeDeliveryAbove: settings?.freeDeliveryAbove ?? "0",
    customDomain: shop.storefrontDomains?.find((domain) => domain.type === "CUSTOM" && domain.status === "ACTIVE")?.hostname ?? "",
    notes: `${shop.slug}.${rootDomain}`,
  };
}

function moduleDraftsFromShop(shop: ShopRecord): Record<string, { status: string; priceOverride: string; billingCycle: string; notes: string }> {
  return Object.fromEntries(modules.map((module) => {
    const subscription = shop.moduleSubscriptions?.find((item) => item.module === module);
    return [module, {
      status: subscription?.status ?? "DISABLED",
      priceOverride: subscription?.priceOverride ?? "",
      billingCycle: subscription?.billingCycle ?? "MONTHLY",
      notes: subscription?.notes ?? "",
    }];
  }));
}

async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

async function loadAllShops(): Promise<ShopRecord[]> {
  const limit = 100;
  const firstPage = await apiGet<{ shops: ShopRecord[]; page: number; limit: number; total: number }>(`/superadmin/shops?limit=${String(limit)}`);
  if (firstPage.shops.length >= firstPage.total) {
    return firstPage.shops;
  }

  const pageCount = Math.ceil(firstPage.total / limit);
  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, async (_, index) => apiGet<{ shops: ShopRecord[] }>(`/superadmin/shops?limit=${String(limit)}&page=${String(index + 2)}`)),
  );
  return [firstPage.shops, ...remainingPages.map((page) => page.shops)].flat();
}

async function apiPost<T = unknown>(path: string, body: object): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
}

async function apiPut<T = unknown>(path: string, body: object): Promise<T> {
  return apiRequest<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

async function apiPatch<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH" });
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string; issues?: Array<{ field?: string; message?: string }> } | null;
    throw new Error(readApiError(body));
  }
  return response.json() as Promise<T>;
}

function cleanPayload(input: object) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "" && value !== undefined)) as Record<string, string | number | boolean | null>;
}

function validateShopForm(form: CreateShopForm): string | null {
  if (form.tenantName.trim().length < 2) return "Shop name must be at least 2 characters.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.tenantSlug.trim())) return "Shop slug can use lowercase letters, numbers, and single hyphens only.";
  if (form.phone.trim().length < 10) return "Shop phone must be at least 10 digits.";
  if (form.ownerName.trim().length < 2) return "Owner name must be at least 2 characters.";
  if (form.ownerPassword.length < 8) return "Owner password must be at least 8 characters.";
  return null;
}

function readApiError(body: { error?: string; message?: string; issues?: Array<{ field?: string; message?: string }> } | null): string {
  if (body?.issues?.length) return body.issues.slice(0, 3).map((issue) => `${fieldLabel(issue.field ?? "")}: ${issue.message ?? "Invalid value"}`).join("; ");
  return body?.error ?? body?.message ?? "Request failed";
}

function fieldLabel(field: string): string {
  if (!field) return "Request";
  return field.replace(/\.(\d+)\./g, " $1 ").replace(/\./g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (letter) => letter.toUpperCase());
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function dateInputValue(value: string | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function parseJson(value: string): unknown {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function prettyJson(value: unknown): string {
  return value == null ? "{}" : JSON.stringify(value, null, 2);
}

function formatSelectOption(option: string): string {
  return option.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
