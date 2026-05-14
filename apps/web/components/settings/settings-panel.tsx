"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, FileText, Image as ImageIcon, MessageCircle, Printer, Save, Trash2, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { apiUrl, createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredAuthSession, getStoredTenant, getStoredVerticalConfig, storeTenant, type StoredTenant } from "@/lib/vertical-config";

interface SettingsResponse {
  tenant: {
    name: string;
    phone: string;
    slug?: string;
    status?: string;
    gstNumber?: string | null;
    gstEnabled?: boolean;
    requirePoApproval?: boolean;
    address?: string | null;
    logoUrl?: string | null;
    vertical: string;
  };
  users: UserRecord[];
}

interface UserRecord {
  id: string;
  primaryStoreId?: string | null;
  name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  role: "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";
  isActive: boolean;
}

interface StoreRecord {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isDefault: boolean;
  isActive: boolean;
  userAssignments: Array<{
    user: {
      id: string;
      name: string;
      email: string;
      username?: string | null;
      role: UserRecord["role"];
    };
  }>;
}

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [requirePoApproval, setRequirePoApproval] = useState(false);
  const [logoRevision, setLogoRevision] = useState(0);
  const role = getStoredAuthSession()?.user?.role;
  const canViewSettings = role === "OWNER" || role === "MANAGER";
  const canEditShop = role === "OWNER";
  const canManageWhatsapp = role === "OWNER";
  const userRoleOptions = role === "OWNER" ? ["OWNER", "MANAGER", "STAFF", "DELIVERY"] : ["STAFF", "DELIVERY"];
  const settingsQuery = useQuery({
    queryKey: ["settings-current"],
    queryFn: () => createAuthenticatedApiClient().get<SettingsResponse>("/settings/current"),
    enabled: canViewSettings,
  });
  const storesQuery = useQuery({
    queryKey: ["settings-stores"],
    queryFn: () => createAuthenticatedApiClient().get<StoreRecord[]>("/settings/stores"),
    enabled: canViewSettings,
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
  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return createAuthenticatedApiClient().uploadForm<{ logoUrl: string | null }>("/settings/logo", form);
    },
    onSuccess: async () => {
      setMessage("Shop logo uploaded.");
      setLogoRevision(Date.now());
      await queryClient.invalidateQueries({ queryKey: ["settings-current"] });
    },
  });
  const deleteLogo = useMutation({
    mutationFn: () => createAuthenticatedApiClient().delete<{ logoUrl: null }>("/settings/logo"),
    onSuccess: async () => {
      setMessage("Shop logo removed.");
      setLogoRevision(Date.now());
      await queryClient.invalidateQueries({ queryKey: ["settings-current"] });
    },
  });
  const createStore = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/settings/stores", payload),
    onSuccess: async () => {
      setMessage("Store added.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings-stores"] }),
        queryClient.invalidateQueries({ queryKey: ["settings-current"] }),
      ]);
    },
  });
  const updateStore = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/settings/stores/${id}`, payload),
    onSuccess: async () => {
      setMessage("Store saved.");
      await queryClient.invalidateQueries({ queryKey: ["settings-stores"] });
    },
  });
  const setDefaultStore = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().put(`/settings/stores/${id}/set-default`, {}),
    onSuccess: async () => {
      setMessage("Default store updated.");
      await queryClient.invalidateQueries({ queryKey: ["settings-stores"] });
    },
  });
  const deleteStore = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/settings/stores/${id}`),
    onSuccess: async () => {
      setMessage("Store deactivated.");
      await queryClient.invalidateQueries({ queryKey: ["settings-stores"] });
    },
  });
  const assignStoreUsers = useMutation({
    mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) => createAuthenticatedApiClient().put(`/settings/stores/${id}/users`, { userIds }),
    onSuccess: async () => {
      setMessage("Store users updated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings-stores"] }),
        queryClient.invalidateQueries({ queryKey: ["settings-current"] }),
      ]);
    },
  });
  const verticalConfig = getStoredVerticalConfig();
  const settings = settingsQuery.data;
  const stores = storesQuery.data ?? [];
  const error = (canViewSettings ? settingsQuery.error : null) ?? storesQuery.error ?? updateTenant.error ?? createUser.error ?? updateUser.error ?? uploadLogo.error ?? deleteLogo.error ?? createStore.error ?? updateStore.error ?? setDefaultStore.error ?? deleteStore.error ?? assignStoreUsers.error;
  const logoSrc = settings?.tenant.logoUrl ? `${apiUrl("/settings/logo/view")}?v=${String(logoRevision)}-${encodeURIComponent(settings.tenant.logoUrl)}` : null;

  useEffect(() => {
    if (settings?.tenant.gstEnabled !== undefined) {
      setGstEnabled(settings.tenant.gstEnabled);
    }
  }, [settings?.tenant.gstEnabled]);

  useEffect(() => {
    if (settings?.tenant.requirePoApproval !== undefined) {
      setRequirePoApproval(settings.tenant.requirePoApproval);
    }
  }, [settings?.tenant.requirePoApproval]);

  function handleTenantSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    updateTenant.mutate({
      name: formString(form, "name"),
      phone: formString(form, "phone"),
      gstEnabled,
      requirePoApproval,
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
        username: formString(form, "username") || undefined,
        phone: formString(form, "phone") || undefined,
        role: formString(form, "role") || "STAFF",
        password: formString(form, "password"),
      },
      {
        onSuccess: () => formElement.reset(),
      },
    );
  }

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    setMessage(null);
    uploadLogo.mutate(file);
    event.currentTarget.value = "";
  }

  function handleStoreSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    createStore.mutate(
      {
        name: formString(form, "name"),
        address: formString(form, "address") || null,
        phone: formString(form, "phone") || null,
        isDefault: form.get("isDefault") === "on",
      },
      {
        onSuccess: () => formElement.reset(),
      },
    );
  }

  function handleStoreEditSubmit(event: React.SyntheticEvent<HTMLFormElement>, storeId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    updateStore.mutate({
      id: storeId,
      payload: {
        name: formString(form, "name"),
        address: formString(form, "address") || null,
        phone: formString(form, "phone") || null,
      },
    });
  }

  function handleStoreUsersSubmit(event: React.SyntheticEvent<HTMLFormElement>, storeId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    assignStoreUsers.mutate({
      id: storeId,
      userIds: form.getAll("userIds").map(String),
    });
  }

  function handleUsernameSubmit(event: React.SyntheticEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    updateUser.mutate({ id: userId, payload: { username: formString(form, "username") } });
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}
      {canViewSettings ? (
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
          {canManageWhatsapp ? (
            <Link className="flex items-center gap-3 rounded-md border border-border bg-white p-4 text-sm text-slate-700" href="/settings/whatsapp">
              <span className="flex size-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                <MessageCircle className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-semibold text-slate-950">WhatsApp Business</span>
                <span className="text-xs text-slate-500">Connect a shop number, receive orders, and send invoice updates.</span>
              </span>
            </Link>
          ) : null}
        </section>
      ) : null}
      {canEditShop ? <section id="shop-details" className="rounded-md border border-border bg-white p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-slate-950">Shop details</div>
          <div className="text-xs text-slate-500">{verticalConfig?.displayName ?? settings?.tenant.vertical ?? "Retail"} | active modules from vertical config</div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-3">
            <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
              {logoSrc ? (
                <img src={logoSrc} alt="Shop logo" className="h-full w-full object-contain" />
              ) : (
                <ImageIcon className="size-7 text-slate-300" aria-hidden="true" />
              )}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-950">Shop logo</div>
              <div className="text-xs text-slate-500">JPG, PNG, or WEBP up to 2 MB. Used on invoice PDFs.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Upload className="size-4" aria-hidden="true" />
              {uploadLogo.isPending ? "Uploading..." : "Upload"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleLogoChange} disabled={uploadLogo.isPending} />
            </label>
            {logoSrc ? (
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  deleteLogo.mutate();
                }}
                disabled={deleteLogo.isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={handleTenantSubmit}>
          <TextInput name="name" label="Shop name" defaultValue={settings?.tenant.name ?? ""} required />
          <TextInput name="phone" label="Phone" defaultValue={settings?.tenant.phone ?? ""} required />
          <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700 md:col-span-2">
            <input type="checkbox" checked={gstEnabled} onChange={(event) => setGstEnabled(event.target.checked)} className="size-4 accent-emerald-600" />
            GST registered shop
          </label>
          {gstEnabled ? <TextInput name="gstNumber" label="GSTIN" defaultValue={settings?.tenant.gstNumber ?? ""} /> : null}
          <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700 md:col-span-2">
            <input type="checkbox" checked={requirePoApproval} onChange={(event) => setRequirePoApproval(event.target.checked)} className="size-4 accent-emerald-600" />
            Require owner/manager approval before receiving purchase orders
          </label>
          <TextInput name="address" label="Address" defaultValue={settings?.tenant.address ?? ""} />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white md:col-span-2" disabled={updateTenant.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save shop details
          </button>
        </form>
      </section> : null}
      {canViewSettings ? (
        <section id="stores" className="rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Building2 className="size-4 text-emerald-600" aria-hidden="true" />
                Stores / Branches
              </div>
              <div className="text-xs text-slate-500">Use one default store now, with user assignments ready for branch-wise data.</div>
            </div>
            {storesQuery.isLoading ? <span className="text-xs text-slate-500">Loading stores...</span> : null}
          </div>
          {canEditShop ? (
            <form className="mb-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-5" onSubmit={handleStoreSubmit}>
              <TextInput name="name" label="Store name" required />
              <TextInput name="phone" label="Phone" />
              <TextInput name="address" label="Address" />
              <label className="flex h-10 items-center gap-2 self-end rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700">
                <input name="isDefault" type="checkbox" className="size-4 accent-emerald-600" />
                Default
              </label>
              <button className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white self-end" disabled={createStore.isPending}>
                Add store
              </button>
            </form>
          ) : null}
          <div className="space-y-3">
            {stores.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">No stores configured yet. The first store you add becomes the default.</div>
            ) : null}
            {stores.map((store) => (
              <div key={store.id} className="rounded-md border border-slate-200 p-3">
                <form className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto]" onSubmit={(event) => handleStoreEditSubmit(event, store.id)}>
                  <TextInput name="name" label="Store name" defaultValue={store.name} required />
                  <TextInput name="phone" label="Phone" defaultValue={store.phone ?? ""} />
                  <TextInput name="address" label="Address" defaultValue={store.address ?? ""} />
                  <button className="h-10 self-end rounded-md border border-border px-3 text-sm font-medium text-slate-700" disabled={!canEditShop || updateStore.isPending}>
                    Save
                  </button>
                  <div className="flex gap-2 self-end">
                    {store.isDefault ? (
                      <span className="inline-flex h-10 items-center rounded-md bg-emerald-50 px-3 text-xs font-bold text-emerald-700">DEFAULT</span>
                    ) : (
                      <button type="button" className="h-10 rounded-md border border-border px-3 text-sm font-medium text-slate-700" disabled={!canEditShop || setDefaultStore.isPending} onClick={() => setDefaultStore.mutate(store.id)}>
                        Set default
                      </button>
                    )}
                    {!store.isDefault ? (
                      <button type="button" className="h-10 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700" disabled={!canEditShop || deleteStore.isPending} onClick={() => deleteStore.mutate(store.id)}>
                        Deactivate
                      </button>
                    ) : null}
                  </div>
                </form>
                <form
                  key={`store-users-${store.id}-${store.userAssignments.map((assignment) => assignment.user.id).sort().join("-")}`}
                  className="mt-3 rounded-md bg-slate-50 p-3"
                  onSubmit={(event) => handleStoreUsersSubmit(event, store.id)}
                >
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned users</div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(settings?.users ?? []).map((user) => {
                      const assigned = store.userAssignments.some((assignment) => assignment.user.id === user.id);
                      return (
                        <label key={`${store.id}-${user.id}`} className="flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-700">
                          <input name="userIds" value={user.id} type="checkbox" defaultChecked={assigned} disabled={!canEditShop} className="size-4 accent-emerald-600" />
                          <span>
                            <span className="block font-medium text-slate-950">{user.name}</span>
                            <span className="block text-xs text-slate-500">{user.role}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {canEditShop ? (
                    <button className="mt-3 h-9 rounded-md border border-border bg-white px-3 text-sm font-medium text-slate-700" disabled={assignStoreUsers.isPending}>
                      Save user assignments
                    </button>
                  ) : null}
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {canViewSettings ? <section id="users" className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Users</div>
        <div className="space-y-2">
          {(settings?.users ?? []).map((user) => (
            <UserRow
              key={user.id}
              user={user}
              currentRole={role}
              roleOptions={userRoleOptions}
              onUsernameSubmit={handleUsernameSubmit}
              onUpdate={(payload) => updateUser.mutate({ id: user.id, payload })}
            />
          ))}
        </div>
        <form className="mt-4 grid gap-3 md:grid-cols-6" onSubmit={handleUserSubmit}>
          <TextInput name="name" label="Name" required />
          <TextInput name="email" label="Email" type="email" required />
          <TextInput name="username" label="Username" />
          <TextInput name="phone" label="Phone" />
          <label className="block text-sm font-medium text-slate-700">
            Role
            <select name="role" className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              {userRoleOptions.map((roleOption) => <option key={roleOption} value={roleOption}>{roleOption}</option>)}
            </select>
          </label>
          <TextInput name="password" label="Password" type="password" required />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-6" disabled={createUser.isPending}>
            <UserPlus className="size-4" aria-hidden="true" />
            Add user
          </button>
        </form>
      </section> : null}
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

function UserRow({
  user,
  currentRole,
  roleOptions,
  onUsernameSubmit,
  onUpdate,
}: Readonly<{
  user: UserRecord;
  currentRole: UserRecord["role"] | undefined;
  roleOptions: string[];
  onUsernameSubmit: (event: React.SyntheticEvent<HTMLFormElement>, userId: string) => void;
  onUpdate: (payload: object) => void;
}>) {
  const canManageUser = currentRole === "OWNER" || user.role === "STAFF" || user.role === "DELIVERY";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
      <div>
        <div className="text-sm font-medium text-slate-950">{user.name}</div>
        <div className="text-xs text-slate-500">
          {user.username ? `@${user.username} | ` : null}
          {user.email} | {user.role} | {user.isActive ? "Active" : "Inactive"}
        </div>
      </div>
      {canManageUser ? (
        <div className="flex flex-wrap gap-2">
          <form className="flex gap-2" onSubmit={(event) => onUsernameSubmit(event, user.id)}>
            <input
              name="username"
              className="h-9 w-40 rounded-md border border-border px-2 text-sm"
              defaultValue={user.username ?? ""}
              placeholder="Login username"
              required
            />
            <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" type="submit">
              Save username
            </button>
          </form>
          <select
            className="h-9 rounded-md border border-border px-2 text-sm"
            value={user.role}
            onChange={(event) => onUpdate({ role: event.target.value })}
          >
            {roleOptions.map((roleOption) => <option key={roleOption} value={roleOption}>{roleOption}</option>)}
          </select>
          <button
            className="h-9 rounded-md border border-border px-3 text-sm text-slate-700"
            onClick={() => onUpdate({ isActive: !user.isActive })}
          >
            {user.isActive ? "Deactivate" : "Activate"}
          </button>
        </div>
      ) : (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">Owner-only management</div>
      )}
    </div>
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
