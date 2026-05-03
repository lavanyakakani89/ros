"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { createAuthenticatedApiClient, type PaginatedResponse } from "@/lib/api-client";
import { formString } from "@/lib/form-values";

interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  creditLimit?: string | number | null;
  outstandingDue: string | number;
  totalSpent?: number;
  lastVisitAt?: string | null;
}

export function CustomersClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const customersQuery = useQuery({
    queryKey: ["customers", search],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<CustomerRecord>>(`/customers?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  const createCustomer = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/customers", payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
  const updateCustomer = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/customers/${id}`, payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
  const customers = customersQuery.data?.data ?? [];
  const error = customersQuery.error ?? createCustomer.error ?? updateCustomer.error;

  function handleCreate(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    createCustomer.mutate(
      {
        name: formString(form, "name"),
        phone: formString(form, "phone"),
        email: formString(form, "email") || undefined,
        address: formString(form, "address") || undefined,
        creditLimit: Number(form.get("creditLimit") || 0),
      },
      { onSuccess: () => formElement.reset() },
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Add customer</div>
        {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
        <form className="space-y-3" onSubmit={handleCreate}>
          <TextInput name="name" label="Name" required />
          <TextInput name="phone" label="Phone" required />
          <TextInput name="email" label="Email" type="email" />
          <TextInput name="address" label="Address" />
          <TextInput name="creditLimit" label="Credit limit" type="number" />
          <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white" disabled={createCustomer.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save customer
          </button>
        </form>
      </section>
      <section className="rounded-md border border-border bg-white">
        <div className="border-b border-border p-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, email" className="h-10 w-full rounded-md border border-border px-3 text-sm" />
        </div>
        <div className="divide-y divide-border">
          {customers.length > 0 ? customers.map((customer) => (
            <CustomerRow key={customer.id} customer={customer} onSave={(payload) => updateCustomer.mutate({ id: customer.id, payload })} />
          )) : <div className="p-4 text-sm text-slate-500">No customers found.</div>}
        </div>
      </section>
    </div>
  );
}

function CustomerRow({ customer, onSave }: Readonly<{ customer: CustomerRecord; onSave: (payload: object) => void }>) {
  const [editing, setEditing] = useState(false);

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: formString(form, "name"),
      phone: formString(form, "phone"),
      email: formString(form, "email") || undefined,
      address: formString(form, "address") || undefined,
      creditLimit: Number(form.get("creditLimit") || 0),
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <TextInput name="name" label="Name" defaultValue={customer.name} required />
        <TextInput name="phone" label="Phone" defaultValue={customer.phone} required />
        <TextInput name="email" label="Email" defaultValue={customer.email ?? ""} />
        <TextInput name="address" label="Address" defaultValue={customer.address ?? ""} />
        <TextInput name="creditLimit" label="Credit limit" type="number" defaultValue={String(customer.creditLimit ?? "")} />
        <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2">Save changes</button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div>
        <div className="text-sm font-medium text-slate-950">{customer.name}</div>
        <div className="text-xs text-slate-500">{customer.phone}{customer.email ? ` | ${customer.email}` : ""}</div>
        <div className="mt-1 text-xs text-slate-500">Due {money(Number(customer.outstandingDue))} | Spent {money(customer.totalSpent ?? 0)}</div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/customers/${customer.id}/ledger`} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 flex items-center">Ledger</Link>
        <button className="h-9 rounded-md border border-border px-3 text-sm text-slate-700" onClick={() => setEditing(true)}>Edit</button>
      </div>
    </div>
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

function money(value: number): string {
  return `INR ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
