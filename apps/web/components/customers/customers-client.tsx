"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, FileSpreadsheet, Save, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient, downloadApiFile, type PaginatedResponse } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredAuthSession } from "@/lib/vertical-config";

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
  birthday?: string | null;
  anniversary?: string | null;
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
}

interface OutstandingCustomer {
  id: string;
  name: string;
  phone: string;
  totalOutstanding: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  oldestUnpaidDate: string | null;
}

export function CustomersClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [listMode, setListMode] = useState<"all" | "outstanding">("all");
  const [page, setPage] = useState(1);
  const [importStatus, setImportStatus] = useState("");
  const pageSize = 25;
  const searchTerm = search.trim();
  const role = getStoredAuthSession()?.user?.role;
  const canImportExport = role === "OWNER" || role === "MANAGER";
  const canSeeCustomerFinancials = role === "OWNER" || role === "MANAGER";
  const customersQuery = useQuery({
    queryKey: ["customers", searchTerm, page, pageSize],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<CustomerRecord>>(`/customers?page=${page}&limit=${pageSize}${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ""}`),
    enabled: listMode === "all",
  });
  const outstandingQuery = useQuery({
    queryKey: ["customers", "outstanding", page, pageSize],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<OutstandingCustomer>>(`/customers/outstanding?page=${page}&limit=${pageSize}&sortBy=amount_due`),
    enabled: listMode === "outstanding" && canSeeCustomerFinancials,
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
  const outstandingCustomers = outstandingQuery.data?.data ?? [];
  useEffect(() => {
    setPage(1);
  }, [listMode, searchTerm]);
  const error = customersQuery.error ?? outstandingQuery.error ?? createCustomer.error ?? updateCustomer.error ?? importCustomers.error;

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
          <CustomerOptionalFields canSeeFinancials={canSeeCustomerFinancials} />
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white md:col-span-2" disabled={createCustomer.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save customer
          </button>
        </form>
      </section>
      <section className="rounded-md border border-border bg-white">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setListMode("all")}
              className={`h-9 rounded-md border px-3 text-sm font-medium ${listMode === "all" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border text-slate-700"}`}
            >
              All customers
            </button>
            {canSeeCustomerFinancials ? (
              <button
                type="button"
                onClick={() => setListMode("outstanding")}
                className={`h-9 rounded-md border px-3 text-sm font-medium ${listMode === "outstanding" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-border text-slate-700"}`}
              >
                Outstanding
              </button>
            ) : null}
          </div>
          {canImportExport ? (
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
          ) : null}
          {importStatus ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{importStatus}</div> : null}
          {listMode === "all" ? (
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, email" className="h-10 w-full rounded-md border border-border px-3 text-sm" />
          ) : null}
        </div>
        {listMode === "outstanding" ? (
          <OutstandingCustomersTable customers={outstandingCustomers} />
        ) : (
          <div className="divide-y divide-border">
            {customers.length > 0 ? customers.map((customer) => (
              <CustomerRow key={customer.id} customer={customer} canSeeFinancials={canSeeCustomerFinancials} onSave={(payload) => updateCustomer.mutate({ id: customer.id, payload })} />
            )) : <div className="p-4 text-sm text-slate-500">No customers found.</div>}
          </div>
        )}
        <PaginationControls
          page={page}
          limit={pageSize}
          total={listMode === "outstanding" ? outstandingQuery.data?.total ?? 0 : customersQuery.data?.total ?? 0}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}

function OutstandingCustomersTable({ customers }: Readonly<{ customers: OutstandingCustomer[] }>) {
  if (customers.length === 0) {
    return <div className="p-4 text-sm text-slate-500">No outstanding customer dues found.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Customer</th>
            <th className="px-4 py-2 text-left font-medium">Phone</th>
            <th className="px-4 py-2 text-right font-medium">Outstanding</th>
            <th className="px-4 py-2 text-right font-medium">Invoices</th>
            <th className="px-4 py-2 text-left font-medium">Oldest invoice</th>
            <th className="px-4 py-2 text-left font-medium">Last invoice</th>
            <th className="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {customers.map((customer) => (
            <tr key={customer.id}>
              <td className="px-4 py-3 font-medium text-slate-950">{customer.name}</td>
              <td className="px-4 py-3 text-slate-600">{customer.phone}</td>
              <td className="px-4 py-3 text-right font-semibold text-amber-700">{money(customer.totalOutstanding)}</td>
              <td className="px-4 py-3 text-right text-slate-600">{customer.invoiceCount}</td>
              <td className="px-4 py-3 text-slate-600">{formatDate(customer.oldestUnpaidDate)}</td>
              <td className="px-4 py-3 text-slate-600">{formatDate(customer.lastInvoiceDate)}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/customers/${customer.id}/ledger`} className="inline-flex h-9 items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700">
                  View ledger
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerRow({ customer, canSeeFinancials, onSave }: Readonly<{ customer: CustomerRecord; canSeeFinancials: boolean; onSave: (payload: object) => void }>) {
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
        <CustomerOptionalFields customer={customer} canSeeFinancials={canSeeFinancials} />
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
        {canSeeFinancials ? <div className="mt-1 text-xs text-slate-500">Due {money(Number(customer.outstandingDue ?? 0))} | Spent {money(customer.totalSpent ?? 0)}</div> : null}
      </div>
      <div className="flex items-center gap-2">
        {canSeeFinancials ? <Link href={`/customers/${customer.id}/ledger`} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 flex items-center">Ledger</Link> : null}
        <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => setEditing(true)}>Edit</button>
      </div>
    </div>
  );
}

function CustomerOptionalFields({ customer, canSeeFinancials }: Readonly<{ customer?: CustomerRecord; canSeeFinancials: boolean }>) {
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
        <TextInput name="birthday" label="Date of birth" type="date" defaultValue={dateInputValue(customer?.birthday)} />
        <TextInput name="anniversary" label="Anniversary date" type="date" defaultValue={dateInputValue(customer?.anniversary)} />
        {canSeeFinancials ? (
          <>
            <TextInput name="openingBalanceType" label="Opening balance type" defaultValue={customer?.openingBalanceType ?? ""} />
            <TextInput name="openingBalance" label="Opening balance" type="number" defaultValue={String(customer?.openingBalance ?? "")} />
            <TextInput name="creditLimit" label="Credit limit" type="number" defaultValue={String(customer?.creditLimit ?? "")} />
            <TextInput name="creditDays" label="Turn around day" type="number" defaultValue={String(customer?.creditDays ?? "")} />
            <TextInput name="itemDiscountPercent" label="Disc% on item" type="number" defaultValue={String(customer?.itemDiscountPercent ?? "")} />
          </>
        ) : null}
        <TextInput name="accountNo" label="Account no." defaultValue={customer?.accountNo ?? ""} />
        <TextInput name="accountName" label="Account name" defaultValue={customer?.accountName ?? ""} />
        <TextInput name="bank" label="Bank" defaultValue={customer?.bank ?? ""} />
        <TextInput name="branch" label="Branch" defaultValue={customer?.branch ?? ""} />
        <TextInput name="ifscCode" label="IFSC code" defaultValue={customer?.ifscCode ?? ""} />
        <TextInput name="remarks" label="Remarks" defaultValue={customer?.remarks ?? ""} />
        {canSeeFinancials ? (
          <>
            <CheckInput name="tcsEnabled" label="TCS" defaultChecked={customer?.tcsEnabled} />
            <CheckInput name="creditLimitEnabled" label="Limit status" defaultChecked={customer?.creditLimitEnabled} />
            <CheckInput name="itemDiscountEnabled" label="Discount status on item" defaultChecked={customer?.itemDiscountEnabled} />
          </>
        ) : null}
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
    birthday: formString(form, "birthday") || undefined,
    anniversary: formString(form, "anniversary") || undefined,
    openingBalanceType: formString(form, "openingBalanceType").toUpperCase() || undefined,
    openingBalance: Number(form.get("openingBalance") || 0),
    tcsEnabled: form.get("tcsEnabled") === "on",
    creditLimit: formString(form, "creditLimit") ? Number(form.get("creditLimit")) : undefined,
    creditLimitEnabled: form.get("creditLimitEnabled") === "on",
    creditDays: formString(form, "creditDays") ? Number(form.get("creditDays")) : undefined,
    itemDiscountPercent: Number(form.get("itemDiscountPercent") || 0),
    itemDiscountEnabled: form.get("itemDiscountEnabled") === "on",
  };
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

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString("en-IN");
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}
