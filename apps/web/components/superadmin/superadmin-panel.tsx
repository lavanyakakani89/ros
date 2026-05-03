"use client";

import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LogOut, PlusCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

const verticals = ["PHARMACY", "GROCERY", "FASHION", "HARDWARE", "ELECTRONICS", "RESTAURANT"] as const;
const plans = ["STARTER", "STANDARD", "PROFESSIONAL", "ENTERPRISE"] as const;
const cycles = ["ONE_TIME", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "TWO_YEARLY", "THREE_YEARLY"] as const;
const adminRoles = ["OWNER", "MANAGER", "SUPPORT"] as const;

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

interface CreateShopForm {
  tenantName: string;
  tenantSlug: string;
  vertical: string;
  phone: string;
  gstNumber: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
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

const emptyShopForm: CreateShopForm = {
  tenantName: "",
  tenantSlug: "",
  vertical: "GROCERY",
  phone: "",
  gstNumber: "",
  address: "",
  ownerName: "",
  ownerEmail: "",
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

export function SuperAdminPanel({ admin }: Readonly<{ admin: SuperAdminIdentity }>) {
  const router = useRouter();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [shopForm, setShopForm] = useState<CreateShopForm>(emptyShopForm);
  const [adminForm, setAdminForm] = useState<CreateAdminForm>(emptyAdminForm);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canManage = admin.role === "OWNER" || admin.role === "MANAGER";
  const canManageAdmins = admin.role === "OWNER";

  const loadData = useCallback(async () => {
    setError(null);
    const [dashboardBody, shopsBody, adminsBody] = await Promise.all([
      apiGet<{ metrics: DashboardMetrics }>("/superadmin/dashboard"),
      apiGet<{ shops: ShopRecord[] }>("/superadmin/shops?limit=100"),
      apiGet<{ admins: AdminRecord[] }>("/superadmin/admins"),
    ]);

    setMetrics(dashboardBody.metrics);
    setShops(shopsBody.shops);
    setAdmins(adminsBody.admins);
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

  function updateAdminField(field: keyof CreateAdminForm, value: string) {
    setAdminForm((current) => ({ ...current, [field]: value }));
  }

  async function createShop() {
    setError(null);
    const body = cleanPayload({
      ...shopForm,
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

  async function changeShopStatus(shop: ShopRecord, action: "warning" | "suspend" | "reactivate") {
    setError(null);
    await apiPatch(`/superadmin/shops/${shop.id}/${action}`);
    setNotice(`${shop.name} updated`);
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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">RetailOS Super Admin</div>
            <div className="text-sm text-slate-400">
              {admin.name} | {admin.role}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-sm" onClick={() => void loadData()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-800 px-3 text-sm" onClick={() => void logout()}>
              <LogOut className="size-4" aria-hidden="true" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {notice ? <div className="rounded-md border border-emerald-800 bg-emerald-950 px-4 py-3 text-sm text-emerald-100">{notice}</div> : null}
        {error ? <div className="rounded-md border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-100">{error}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {metricItems(metrics).map((item) => (
            <div key={item.label} className="rounded-md border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs font-medium uppercase text-slate-500">{item.label}</div>
              <div className="mt-2 text-2xl font-semibold">{loading ? "-" : item.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-md border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="font-semibold">Shops</div>
                <div className="text-sm text-slate-400">License and access status</div>
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
                <tbody className="divide-y divide-slate-800">
                  {shops.map((shop) => (
                    <tr key={shop.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{shop.name}</div>
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
                      <td className="px-4 py-3 text-slate-300">
                        {(shop._count?.products ?? 0).toString()} products / {(shop._count?.invoices ?? 0).toString()} bills
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-700 px-2 text-xs text-amber-200 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void changeShopStatus(shop, "warning").catch((err: unknown) => setError(readError(err)))}
                          >
                            <ShieldAlert className="size-3" aria-hidden="true" />
                            Warn
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-red-700 px-2 text-xs text-red-200 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void changeShopStatus(shop, "suspend").catch((err: unknown) => setError(readError(err)))}
                          >
                            <ShieldAlert className="size-3" aria-hidden="true" />
                            Suspend
                          </button>
                          <button
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-700 px-2 text-xs text-emerald-200 disabled:opacity-40"
                            disabled={!canManage}
                            onClick={() => void changeShopStatus(shop, "reactivate").catch((err: unknown) => setError(readError(err)))}
                          >
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            Active
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form className="rounded-md border border-slate-800 bg-slate-900 p-4" onSubmit={onCreateShop}>
            <div className="mb-4 flex items-center gap-2 font-semibold">
              <PlusCircle className="size-4" aria-hidden="true" />
              Create Shop
            </div>
            <div className="grid gap-3">
              <TextInput label="Shop name" value={shopForm.tenantName} onChange={(value) => updateShopField("tenantName", value)} required />
              <TextInput label="Shop slug" value={shopForm.tenantSlug} onChange={(value) => updateShopField("tenantSlug", value)} required />
              <SelectInput label="Vertical" value={shopForm.vertical} options={verticals} onChange={(value) => updateShopField("vertical", value)} />
              <TextInput label="Phone" value={shopForm.phone} onChange={(value) => updateShopField("phone", value)} required />
              <TextInput label="Owner name" value={shopForm.ownerName} onChange={(value) => updateShopField("ownerName", value)} required />
              <TextInput label="Owner email" type="email" value={shopForm.ownerEmail} onChange={(value) => updateShopField("ownerEmail", value)} required />
              <TextInput label="Owner password" type="password" value={shopForm.ownerPassword} onChange={(value) => updateShopField("ownerPassword", value)} required />
              <SelectInput label="Plan" value={shopForm.plan} options={plans} onChange={(value) => updateShopField("plan", value)} />
              <SelectInput label="Billing cycle" value={shopForm.billingCycle} options={cycles} onChange={(value) => updateShopField("billingCycle", value)} />
              <TextInput label="Amount paid" type="number" value={shopForm.amountPaid} onChange={(value) => updateShopField("amountPaid", value)} />
            </div>
            <button className="mt-4 h-10 w-full rounded-md bg-emerald-500 text-sm font-semibold text-slate-950 disabled:opacity-40" type="submit" disabled={!canManage}>
              Create shop
            </button>
          </form>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.7fr]">
          <div className="rounded-md border border-slate-800 bg-slate-900">
            <div className="border-b border-slate-800 px-4 py-3 font-semibold">Super Admins</div>
            <div className="divide-y divide-slate-800">
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

          <form className="rounded-md border border-slate-800 bg-slate-900 p-4" onSubmit={onCreateAdmin}>
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
    return `${base} bg-emerald-950 text-emerald-200`;
  }

  if (status === "WARNING") {
    return `${base} bg-amber-950 text-amber-200`;
  }

  return `${base} bg-red-950 text-red-200`;
}

function TextInput({
  label,
  value,
  onChange,
  required,
  type = "text",
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "email" | "number" | "password" | "text";
}>) {
  return (
    <label className="block text-sm font-medium text-slate-300">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-500"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
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
    <label className="block text-sm font-medium text-slate-300">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
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
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(body?.error ?? body?.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

function cleanPayload(input: object) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "")) as Record<string, string | number>;
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
