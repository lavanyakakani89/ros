"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, MapPin, MessageCircle, Printer, Save, Trash2, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { parseLocationCoordinates } from "@/lib/location-coordinate-parser";
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
  store: {
    id: string;
    name: string;
    address?: string | null;
    phone?: string | null;
    depotName?: string | null;
    depotAddress?: string | null;
    depotLatitude?: string | number | null;
    depotLongitude?: string | number | null;
  } | null;
  users: UserRecord[];
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  role: "OWNER" | "MANAGER" | "STAFF" | "DELIVERY";
  isActive: boolean;
}

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [depotName, setDepotName] = useState("");
  const [depotAddress, setDepotAddress] = useState("");
  const [depotLatitude, setDepotLatitude] = useState("");
  const [depotLongitude, setDepotLongitude] = useState("");
  const [depotCoordinateInput, setDepotCoordinateInput] = useState("");
  const [depotCoordinateError, setDepotCoordinateError] = useState("");
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
  const deleteUser = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/settings/users/${id}`),
    onSuccess: async () => {
      setMessage("User deleted.");
      await queryClient.invalidateQueries({ queryKey: ["settings-current"] });
    },
  });
  const verticalConfig = getStoredVerticalConfig();
  const settings = settingsQuery.data;
  const error = settingsQuery.error ?? updateTenant.error ?? createUser.error ?? updateUser.error ?? deleteUser.error;

  useEffect(() => {
    if (settings?.tenant.gstEnabled !== undefined) {
      setGstEnabled(settings.tenant.gstEnabled);
    }
  }, [settings?.tenant.gstEnabled]);

  useEffect(() => {
    if (!settings) return;
    const store = settings.store;
    const storeDepotLatitude = store?.depotLatitude;
    const storeDepotLongitude = store?.depotLongitude;
    setDepotName(store?.depotName ?? store?.name ?? settings.tenant.name);
    setDepotAddress(store?.depotAddress ?? store?.address ?? settings.tenant.address ?? "");
    setDepotLatitude(storeDepotLatitude === null || storeDepotLatitude === undefined ? "" : String(storeDepotLatitude));
    setDepotLongitude(storeDepotLongitude === null || storeDepotLongitude === undefined ? "" : String(storeDepotLongitude));
    setDepotCoordinateInput(storeDepotLatitude && storeDepotLongitude ? `${String(storeDepotLatitude)}, ${String(storeDepotLongitude)}` : "");
    setDepotCoordinateError("");
  }, [settings]);

  const depotCoordinates = validCoordinates(depotLatitude, depotLongitude);

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
      depotName: depotName.trim() || null,
      depotAddress: depotAddress.trim() || null,
      depotLatitude: depotCoordinates?.latitude ?? null,
      depotLongitude: depotCoordinates?.longitude ?? null,
    });
  }

  function handleDepotCoordinateInput(value: string) {
    setDepotCoordinateInput(value);
    if (!value.trim()) {
      setDepotCoordinateError("");
      return;
    }

    const parsed = parseLocationCoordinates(value);
    if (!parsed) {
      setDepotCoordinateError("No coordinates found. Paste a full Google Maps URL or latitude, longitude.");
      return;
    }

    setDepotLatitude(String(parsed.latitude));
    setDepotLongitude(String(parsed.longitude));
    setDepotCoordinateError("");
  }

  function clearDepotCoordinates() {
    setDepotCoordinateInput("");
    setDepotLatitude("");
    setDepotLongitude("");
    setDepotCoordinateError("");
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

  function handleUsernameSubmit(event: React.SyntheticEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    updateUser.mutate({ id: userId, payload: { username: formString(form, "username") } });
  }

  function confirmDeleteUser(user: UserRecord) {
    setMessage(null);
    const confirmed = window.confirm(`Delete ${user.name}? This permanently removes the user login. Use Deactivate instead if the user has business history.`);
    if (!confirmed) return;
    deleteUser.mutate(user.id);
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
          <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-2 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="text-sm font-semibold text-slate-950">Depot location</div>
              <div className="text-xs text-slate-500">Used as the default route start and return point.</div>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Depot name
              <input value={depotName} onChange={(event) => setDepotName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Depot address
              <input value={depotAddress} onChange={(event) => setDepotAddress(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" />
            </label>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700">
                Depot map link or coordinates
                <input
                  value={depotCoordinateInput}
                  onChange={(event) => handleDepotCoordinateInput(event.target.value)}
                  placeholder="Paste Google Maps URL or 17.3936069, 78.3796996"
                  className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600"
                />
              </label>
              {depotCoordinates ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <div className="flex min-w-0 items-center gap-2">
                    <MapPin className="size-4 shrink-0" aria-hidden="true" />
                    <span className="break-words">
                      Depot coordinates: {depotCoordinates.latitude.toFixed(7)}, {depotCoordinates.longitude.toFixed(7)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={googleMapsUrl(depotCoordinates)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-xs font-medium text-emerald-800">
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      Open
                    </a>
                    <button type="button" onClick={clearDepotCoordinates} className="inline-flex size-8 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800" aria-label="Clear depot coordinates">
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
              {depotCoordinateError ? <div className="mt-2 text-xs text-amber-700">{depotCoordinateError}</div> : null}
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Depot lat
              <input value={depotLatitude} onChange={(event) => setDepotLatitude(event.target.value)} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Depot lng
              <input value={depotLongitude} onChange={(event) => setDepotLongitude(event.target.value)} inputMode="decimal" className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600" />
            </label>
          </div>
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
                <div className="text-xs text-slate-500">
                  {user.username ? `@${user.username} | ` : null}
                  {user.email} | {user.role} | {user.isActive ? "Active" : "Inactive"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <form className="flex gap-2" onSubmit={(event) => handleUsernameSubmit(event, user.id)}>
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
                <button
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  onClick={() => confirmDeleteUser(user)}
                  disabled={deleteUser.isPending}
                  title="Delete user login"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </div>
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
              {["STAFF", "MANAGER", "DELIVERY"].map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <TextInput name="password" label="Password" type="password" required />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-6" disabled={createUser.isPending}>
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

function validCoordinates(latitudeValue: string, longitudeValue: string): { latitude: number; longitude: number } | null {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function googleMapsUrl(coordinates: { latitude: number; longitude: number }): string {
  return `https://www.google.com/maps?q=${coordinates.latitude.toString()},${coordinates.longitude.toString()}`;
}
