"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { createAuthenticatedApiClient, type PaginatedResponse } from "@/lib/api-client";
import { formString } from "@/lib/form-values";

interface SupplierRecord {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  _count?: {
    products: number;
    purchaseOrders: number;
  };
}

export function SuppliersClient() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const suppliersQuery = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () => createAuthenticatedApiClient().get<PaginatedResponse<SupplierRecord>>(`/suppliers?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  const createSupplier = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/suppliers", payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
  const updateSupplier = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/suppliers/${id}`, payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
  const suppliers = suppliersQuery.data?.data ?? [];
  const error = suppliersQuery.error ?? createSupplier.error ?? updateSupplier.error;

  function handleCreate(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    createSupplier.mutate(
      {
        name: formString(form, "name"),
        phone: formString(form, "phone"),
        email: formString(form, "email") || undefined,
        gstNumber: formString(form, "gstNumber") || undefined,
        address: formString(form, "address") || undefined,
      },
      { onSuccess: () => formElement.reset() },
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Add supplier</div>
        {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
        <form className="space-y-3" onSubmit={handleCreate}>
          <TextInput name="name" label="Name" required />
          <TextInput name="phone" label="Phone" required />
          <TextInput name="email" label="Email" type="email" />
          <TextInput name="gstNumber" label="GSTIN" />
          <TextInput name="address" label="Address" />
          <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white" disabled={createSupplier.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save supplier
          </button>
        </form>
      </section>
      <section className="rounded-md border border-border bg-white">
        <div className="border-b border-border p-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, GSTIN" className="h-10 w-full rounded-md border border-border px-3 text-sm" />
        </div>
        <div className="divide-y divide-border">
          {suppliers.length > 0 ? suppliers.map((supplier) => (
            <SupplierRow key={supplier.id} supplier={supplier} onSave={(payload) => updateSupplier.mutate({ id: supplier.id, payload })} />
          )) : <div className="p-4 text-sm text-slate-500">No suppliers found.</div>}
        </div>
      </section>
    </div>
  );
}

function SupplierRow({ supplier, onSave }: Readonly<{ supplier: SupplierRecord; onSave: (payload: object) => void }>) {
  const [editing, setEditing] = useState(false);

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: formString(form, "name"),
      phone: formString(form, "phone"),
      email: formString(form, "email") || undefined,
      gstNumber: formString(form, "gstNumber") || undefined,
      address: formString(form, "address") || undefined,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <TextInput name="name" label="Name" defaultValue={supplier.name} required />
        <TextInput name="phone" label="Phone" defaultValue={supplier.phone} required />
        <TextInput name="email" label="Email" defaultValue={supplier.email ?? ""} />
        <TextInput name="gstNumber" label="GSTIN" defaultValue={supplier.gstNumber ?? ""} />
        <TextInput name="address" label="Address" defaultValue={supplier.address ?? ""} />
        <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white md:col-span-2">Save changes</button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div>
        <div className="text-sm font-medium text-slate-950">{supplier.name}</div>
        <div className="text-xs text-slate-500">{supplier.phone}{supplier.gstNumber ? ` | GSTIN ${supplier.gstNumber}` : ""}</div>
        <div className="mt-1 text-xs text-slate-500">{supplier._count?.products ?? 0} products | {supplier._count?.purchaseOrders ?? 0} purchase orders</div>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/suppliers/${supplier.id}/payments`} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 flex items-center">Payments</Link>
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
