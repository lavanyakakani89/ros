"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, MessageCircle, Printer, Save, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredTenant, getStoredVerticalConfig, storeTenant, type StoredTenant } from "@/lib/vertical-config";

interface SettingsResponse {
  tenant: {
    name: string;
    phone: string;
    slug?: string;
    status?: string;
    gstNumber?: string | null;
    gstEnabled?: boolean;
    address?: string | null;
    vertical: string;
  };
  users: UserRecord[];
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";
  isActive: boolean;
}

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [gstEnabled, setGstEnabled] = useState(true);
  const settingsQuery = useQuery({
    queryKey: ["settings-current"],
    queryFn: () => createAuthenticatedApiClient().get<SettingsResponse>("/settings/current"),
  });
  const updateTenant = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().put<SettingsResponse["tenant"]>("/settings/tenant", payload),
    onSuccess: async (tenant) => {
      setMessage("Shop details saved.");
      const storedTenant = getStoredTenant();
      const nextTenant: StoredTenant = {
        name: tenant.name,
        slug: tenant.slug ?? storedTenant?.slug ?? "",
      };
      const status = tenant.status ?? storedTenant?.status;
      if (status) nextTenant.status = status;
      if (tenant.gstEnabled !== undefined) nextTenant.gstEnabled = tenant.gstEnabled;
      if (tenant.gstNumber !== undefined) nextTenant.gstNumber = tenant.gstNumber;
      storeTenant(nextTenant);
      await queryClient.invalidateQueries({ queryKey: ["settings-current"] });
    },
  });
  const createUser = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/settings/users", payload),
    onSuccess: async () => {
      setMessage("User added.");
      await queryClient.invalidateQueries({ queryKey: ["settings-current"] });
    },
  });
  const updateUser = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/settings/users/${id}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings-current"] });
    },
  });
  const verticalConfig = getStoredVerticalConfig();
  const settings = settingsQuery.data;
  const error = settingsQuery.error ?? updateTenant.error ?? createUser.error ?? updateUser.error;

  useEffect(() => {
    if (settings?.tenant.gstEnabled !== undefined) {
      setGstEnabled(settings.tenant.gstEnabled);
    }
  }, [settings?.tenant.gstEnabled]);

  function handleTenantSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    updateTenant.mutate({
      name: formString(form, "name"),
      phone: formString(form, "phone"),
      gstEnabled,
      gstNumber: gstEnabled ? formString(form, "gstNumber") || null : null,
      address: formString(form, "address") || null,
    });
  }

  function handleUserSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    createUser.mutate(
      {
        name: formString(form, "name"),
        email: formString(form, "email"),
        phone: formString(form, "phone") || undefined,
        role: formString(form, "role") || "STAFF",
        password: formString(form, "password"),
      },
      {
        onSuccess: () => formElement.reset(),
      },
    );
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}
      <section className="grid gap-3 md:grid-cols-2">
        <Link className="flex items-center gap-3 rounded-md border border-border bg-white p-4 text-sm text-slate-700" href="/settings/templates">
          <span className="flex size-10 items-center justify-center rounded-md bg-sky-50 text-sky-700">
            <FileText className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold text-slate-950">Invoice templates</span>
            <span className="text-xs text-slate-500">Thermal, A5, A4, and shop default templates.</span>
          </span>
        </Link>
        <Link className="flex items-center gap-3 rounded-md border border-border bg-white p-4 text-sm text-slate-700" href="/settings/printer">
          <span className="flex size-10 items-center justify-center rounded-md bg-amber-50 text-amber-700">
            <Printer className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold text-slate-950">Printer setup</span>
            <span className="text-xs text-slate-500">Local agent, network ESC/POS, PrintNode USB, Bluetooth payloads.</span>
          </span>
        </Link>
        <Link className="flex items-center gap-3 rounded-md border border-border bg-white p-4 text-sm text-slate-700" href="/settings/whatsapp">
          <span className="flex size-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <MessageCircle className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold text-slate-950">WhatsApp Business</span>
            <span className="text-xs text-slate-500">Connect a shop number, receive orders, and send invoice updates.</span>
          </span>
        </Link>
      </section>
      <section id="shop-details" className="rounded-md border border-border bg-white p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-slate-950">Shop details</div>
          <div className="text-xs text-slate-500">{verticalConfig?.displayName ?? settings?.tenant.vertical ?? "Retail"} | active modules from vertical config</div>
        </div>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={handleTenantSubmit}>
          <TextInput name="name" label="Shop name" defaultValue={settings?.tenant.name ?? ""} required />
          <TextInput name="phone" label="Phone" defaultValue={settings?.tenant.phone ?? ""} required />
          <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700 md:col-span-2">
            <input type="checkbox" checked={gstEnabled} onChange={(event) => setGstEnabled(event.target.checked)} className="size-4 accent-emerald-600" />
            GST registered shop
          </label>
          {gstEnabled ? <TextInput name="gstNumber" label="GSTIN" defaultValue={settings?.tenant.gstNumber ?? ""} /> : null}
          <TextInput name="address" label="Address" defaultValue={settings?.tenant.address ?? ""} />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white md:col-span-2" disabled={updateTenant.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save shop details
          </button>
        </form>
      </section>
      <section id="users" className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Users</div>
        <div className="space-y-2">
          {(settings?.users ?? []).map((user) => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
              <div>
                <div className="text-sm font-medium text-slate-950">{user.name}</div>
                <div className="text-xs text-slate-500">{user.email} | {user.role} | {user.isActive ? "Active" : "Inactive"}</div>
              </div>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border border-border px-2 text-sm"
                  value={user.role}
                  onChange={(event) => updateUser.mutate({ id: user.id, payload: { role: event.target.value } })}
                >
                  {["OWNER", "MANAGER", "STAFF", "DELIVERY"].map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button
                  className="h-9 rounded-md border border-border px-3 text-sm text-slate-700"
                  onClick={() => updateUser.mutate({ id: user.id, payload: { isActive: !user.isActive } })}
                >
                  {user.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
        <form className="mt-4 grid gap-3 md:grid-cols-5" onSubmit={handleUserSubmit}>
          <TextInput name="name" label="Name" required />
          <TextInput name="email" label="Email" type="email" required />
          <TextInput name="phone" label="Phone" />
          <label className="block text-sm font-medium text-slate-700">
            Role
            <select name="role" className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              {["STAFF", "MANAGER", "DELIVERY"].map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <TextInput name="password" label="Password" type="password" required />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-5" disabled={createUser.isPending}>
            <UserPlus className="size-4" aria-hidden="true" />
            Add user
          </button>
        </form>
      </section>
      <PasswordPanel />
    </div>
  );
}

function PasswordPanel() {
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().put("/settings/password", payload),
    onSuccess: () => setMessage("Password changed. Sign in again on other devices."),
  });

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      currentPassword: formString(form, "currentPassword"),
      newPassword: formString(form, "newPassword"),
    });
  }

  return (
    <section id="password" className="rounded-md border border-border bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-950">Change password</div>
      {mutation.error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mutation.error.message}</div> : null}
      {message ? <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}
      <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
        <TextInput name="currentPassword" label="Current password" type="password" required />
        <TextInput name="newPassword" label="New password" type="password" required />
        <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2" disabled={mutation.isPending}>Change password</button>
      </form>
    </section>
  );
}

function TextInput({ name, label, type = "text", defaultValue, required }: Readonly<{ name: string; label: string; type?: string; defaultValue?: string | undefined; required?: boolean }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600" />
    </label>
  );
}
