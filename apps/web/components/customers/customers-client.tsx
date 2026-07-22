"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, ExternalLink, FileSpreadsheet, MapPin, Save, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient, downloadApiFile, type PaginatedResponse } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { parseLocationCoordinates, type ParsedCoordinates } from "@/lib/location-coordinate-parser";

interface CustomerRecord {
  id: string;
  customerCode?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  remarks?: string | null;
  accountNo?: string | null;
  accountName?: string | null;
  bank?: string | null;
  branch?: string | null;
  ifscCode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  openingBalanceType?: string | null;
  openingBalance?: string | number | null;
  tcsEnabled?: boolean;
  creditLimit?: string | number | null;
  creditLimitEnabled?: boolean;
  creditDays?: number | null;
  itemDiscountPercent?: string | number | null;
  itemDiscountEnabled?: boolean;
  outstandingDue: string | number;
  totalSpent?: number;
  lastVisitAt?: string | null;
  locations?: CustomerLocationRecord[];
}

interface CustomerLocationRecord {
  id: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  geocodingProvider?: string | null;
  geocodingQuery?: string | null;
  isDefault?: boolean;
}

export function CustomersClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [importStatus, setImportStatus] = useState("");
  const pageSize = 25;
  const searchTerm = search.trim();
  const customersQuery = useQuery({
    queryKey: ["customers", searchTerm, page, pageSize],
    queryFn: () =>
      createAuthenticatedApiClient().get<PaginatedResponse<CustomerRecord>>(
        `/customers?page=${String(page)}&limit=${String(pageSize)}${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ""}`,
      ),
  });
  const createCustomer = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/customers", payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
  const updateCustomer = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/customers/${id}`, payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
  const importCustomers = useMutation({
    mutationFn: (file: File) => createAuthenticatedApiClient().upload<ImportResult>("/customers/import", file),
    onSuccess: async (result) => {
      setImportStatus(`Imported ${String(result.created)} new and ${String(result.updated)} updated. Failed ${String(result.failed)}.`);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  const customers = customersQuery.data?.data ?? [];
  useEffect(() => {
    setPage(1);
  }, [searchTerm]);
  const error = customersQuery.error ?? createCustomer.error ?? updateCustomer.error ?? importCustomers.error;

  function handleCreate(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    createCustomer.mutate(buildCustomerPayload(form), { onSuccess: () => formElement.reset() });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Add customer</div>
        {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
        <form className="grid gap-3" onSubmit={handleCreate}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput name="customerCode" label="Customer ID" required />
            <TextInput name="name" label="Customer name" required />
            <TextInput name="phone" label="Contact No." required />
            <TextInput name="address" label="Address" required />
          </div>
          <CustomerCoordinateInput />
          <CustomerOptionalFields />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white md:col-span-2" disabled={createCustomer.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save customer
          </button>
        </form>
      </section>
      <section className="rounded-md border border-border bg-white">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void downloadApiFile("/customers/template", "retailos-customer-template.xls")}>
              <FileSpreadsheet className="size-4 text-emerald-700" aria-hidden="true" />
              Template
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void downloadApiFile("/customers/export", "retailos-customers-export.xls")}>
              <Download className="size-4 text-blue-700" aria-hidden="true" />
              Export
            </button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
              <Upload className="size-4 text-amber-700" aria-hidden="true" />
              Import
              <input type="file" accept=".xls,.xlsx,.csv" className="hidden" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  importCustomers.mutate(file);
                }
                event.currentTarget.value = "";
              }} />
            </label>
          </div>
          {importStatus ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{importStatus}</div> : null}
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, email" className="h-10 w-full rounded-md border border-border px-3 text-sm" />
        </div>
        <div className="divide-y divide-border">
          {customers.length > 0 ? customers.map((customer) => (
            <CustomerRow key={customer.id} customer={customer} onSave={(payload) => updateCustomer.mutate({ id: customer.id, payload })} />
          )) : <div className="p-4 text-sm text-slate-500">No customers found.</div>}
        </div>
        <PaginationControls page={page} limit={pageSize} total={customersQuery.data?.total ?? 0} onPageChange={setPage} />
      </section>
    </div>
  );
}

function CustomerRow({ customer, onSave }: Readonly<{ customer: CustomerRecord; onSave: (payload: object) => void }>) {
  const [editing, setEditing] = useState(false);

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave(buildCustomerPayload(form));
    setEditing(false);
  }

  if (editing) {
    return (
      <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <TextInput name="customerCode" label="Customer ID" defaultValue={customer.customerCode ?? ""} required />
        <TextInput name="name" label="Customer name" defaultValue={customer.name} required />
        <TextInput name="phone" label="Contact No." defaultValue={customer.phone} required />
        <TextInput name="address" label="Address" defaultValue={customer.address ?? ""} required />
        <CustomerCoordinateInput customer={customer} />
        <CustomerOptionalFields customer={customer} />
        <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2">Save changes</button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div>
        <div className="text-sm font-medium text-slate-950">{customer.name}</div>
        <div className="text-xs text-slate-500">{customer.phone}{customer.email ? ` | ${customer.email}` : ""}</div>
        <div className="mt-1 text-xs text-slate-500">{customer.address ?? ""}{customer.gstin ? ` | GSTIN ${customer.gstin}` : ""}</div>
        <CustomerLocationSummary customer={customer} />
        <div className="mt-1 text-xs text-slate-500">Due {money(Number(customer.outstandingDue))} | Spent {money(customer.totalSpent ?? 0)}</div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/customers/${customer.id}/ledger`} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 flex items-center">Ledger</Link>
        <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => setEditing(true)}>Edit</button>
      </div>
    </div>
  );
}

function CustomerCoordinateInput({ customer }: Readonly<{ customer?: CustomerRecord }>) {
  const defaultLocation = customer?.locations?.find((location) => location.isDefault) ?? customer?.locations?.[0];
  const initialCoordinates = coordinatesFromLocation(defaultLocation);
  const [rawInput, setRawInput] = useState(defaultLocation?.geocodingQuery ?? "");
  const [coordinates, setCoordinates] = useState<ParsedCoordinates | null>(initialCoordinates);
  const [error, setError] = useState("");

  function handleInput(value: string) {
    setRawInput(value);
    if (!value.trim()) {
      setCoordinates(null);
      setError("");
      return;
    }

    const parsed = parseLocationCoordinates(value);
    setCoordinates(parsed);
    setError(parsed ? "" : "No coordinates found. Paste a full Google Maps URL or latitude, longitude.");
  }

  function clearCoordinates() {
    setRawInput("");
    setCoordinates(null);
    setError("");
  }

  return (
    <div className="rounded-md border border-border bg-slate-50 p-3 md:col-span-2">
      <label className="block text-sm font-medium text-slate-700">
        Map link or coordinates
        <input
          value={rawInput}
          onChange={(event) => handleInput(event.target.value)}
          placeholder="Paste Google Maps URL or 17.3936069, 78.3796996"
          className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-emerald-600"
        />
      </label>
      {coordinates ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <div className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span className="break-words">
              Location found: {coordinates.latitude.toFixed(7)}, {coordinates.longitude.toFixed(7)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a href={googleMapsUrl(coordinates)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-xs font-medium text-emerald-800">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open
            </a>
            <button type="button" onClick={clearCoordinates} className="inline-flex size-8 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800" aria-label="Clear coordinates">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="mt-2 text-xs text-amber-700">{error}</div> : null}
      <input type="hidden" name="locationLatitude" value={coordinates?.latitude ?? ""} />
      <input type="hidden" name="locationLongitude" value={coordinates?.longitude ?? ""} />
      <input type="hidden" name="locationSource" value={coordinates?.source ?? ""} />
      <input type="hidden" name="locationQuery" value={rawInput} />
    </div>
  );
}

function CustomerLocationSummary({ customer }: Readonly<{ customer: CustomerRecord }>) {
  const location = customer.locations?.find((item) => item.isDefault) ?? customer.locations?.[0];
  const coordinates = coordinatesFromLocation(location);
  if (!coordinates) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-emerald-700">
      <span>Coordinates {coordinates.latitude.toFixed(7)}, {coordinates.longitude.toFixed(7)}</span>
      <a href={googleMapsUrl(coordinates)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium">
        <ExternalLink className="size-3" aria-hidden="true" />
        Open
      </a>
    </div>
  );
}

function CustomerOptionalFields({ customer }: Readonly<{ customer?: CustomerRecord }>) {
  return (
    <details className="rounded-md border border-border bg-slate-50 md:col-span-2">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-semibold text-slate-700">
        Additional details
        <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
      </summary>
      <div className="grid gap-3 border-t border-border bg-white p-3 md:grid-cols-2">
        <TextInput name="email" label="Email" type="email" defaultValue={customer?.email ?? ""} />
        <TextInput name="gstin" label="GSTIN / UID" defaultValue={customer?.gstin ?? ""} />
        <TextInput name="pan" label="PAN" defaultValue={customer?.pan ?? ""} />
        <TextInput name="cin" label="CIN" defaultValue={customer?.cin ?? ""} />
        <TextInput name="openingBalanceType" label="Opening balance type" defaultValue={customer?.openingBalanceType ?? ""} />
        <TextInput name="openingBalance" label="Opening balance" type="number" defaultValue={String(customer?.openingBalance ?? "")} />
        <TextInput name="creditLimit" label="Credit limit" type="number" defaultValue={String(customer?.creditLimit ?? "")} />
        <TextInput name="creditDays" label="Turn around day" type="number" defaultValue={String(customer?.creditDays ?? "")} />
        <TextInput name="itemDiscountPercent" label="Disc% on item" type="number" defaultValue={String(customer?.itemDiscountPercent ?? "")} />
        <TextInput name="accountNo" label="Account no." defaultValue={customer?.accountNo ?? ""} />
        <TextInput name="accountName" label="Account name" defaultValue={customer?.accountName ?? ""} />
        <TextInput name="bank" label="Bank" defaultValue={customer?.bank ?? ""} />
        <TextInput name="branch" label="Branch" defaultValue={customer?.branch ?? ""} />
        <TextInput name="ifscCode" label="IFSC code" defaultValue={customer?.ifscCode ?? ""} />
        <TextInput name="remarks" label="Remarks" defaultValue={customer?.remarks ?? ""} />
        <CheckInput name="tcsEnabled" label="TCS" defaultChecked={customer?.tcsEnabled} />
        <CheckInput name="creditLimitEnabled" label="Limit status" defaultChecked={customer?.creditLimitEnabled} />
        <CheckInput name="itemDiscountEnabled" label="Discount status on item" defaultChecked={customer?.itemDiscountEnabled} />
      </div>
    </details>
  );
}

function TextInput({ name, label, type = "text", defaultValue, required }: Readonly<{ name: string; label: string; type?: string; defaultValue?: string; required?: boolean }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} required={required} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600" />
    </label>
  );
}

function CheckInput({ name, label, defaultChecked }: Readonly<{ name: string; label: string; defaultChecked?: boolean | undefined }>) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="size-4 accent-emerald-600" />
      {label}
    </label>
  );
}

function buildCustomerPayload(form: FormData): Record<string, unknown> {
  const location = locationPayload(form);
  return {
    customerCode: formString(form, "customerCode") || undefined,
    name: formString(form, "name"),
    phone: formString(form, "phone"),
    email: formString(form, "email") || undefined,
    address: formString(form, "address") || undefined,
    remarks: formString(form, "remarks") || undefined,
    accountNo: formString(form, "accountNo") || undefined,
    accountName: formString(form, "accountName") || undefined,
    bank: formString(form, "bank") || undefined,
    branch: formString(form, "branch") || undefined,
    ifscCode: formString(form, "ifscCode") || undefined,
    gstin: formString(form, "gstin") || undefined,
    pan: formString(form, "pan") || undefined,
    cin: formString(form, "cin") || undefined,
    openingBalanceType: formString(form, "openingBalanceType").toUpperCase() || undefined,
    openingBalance: Number(form.get("openingBalance") || 0),
    tcsEnabled: form.get("tcsEnabled") === "on",
    creditLimit: formString(form, "creditLimit") ? Number(form.get("creditLimit")) : undefined,
    creditLimitEnabled: form.get("creditLimitEnabled") === "on",
    creditDays: formString(form, "creditDays") ? Number(form.get("creditDays")) : undefined,
    itemDiscountPercent: Number(form.get("itemDiscountPercent") || 0),
    itemDiscountEnabled: form.get("itemDiscountEnabled") === "on",
    ...(location ? { location } : {}),
  };
}

function locationPayload(form: FormData) {
  const latitude = formString(form, "locationLatitude");
  const longitude = formString(form, "locationLongitude");
  if (!latitude || !longitude) return undefined;

  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    source: formString(form, "locationSource") || "COORDINATES",
    query: formString(form, "locationQuery") || undefined,
  };
}

function coordinatesFromLocation(location: CustomerLocationRecord | undefined): ParsedCoordinates | null {
  if (!location?.latitude || !location.longitude) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    source: location.geocodingProvider === "google_maps_url" ? "GOOGLE_MAPS_URL" : "COORDINATES",
  };
}

function googleMapsUrl(coordinates: Pick<ParsedCoordinates, "latitude" | "longitude">): string {
  return `https://www.google.com/maps?q=${coordinates.latitude.toString()},${coordinates.longitude.toString()}`;
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
}

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
