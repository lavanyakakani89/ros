"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { createAuthenticatedApiClient } from "@/lib/api-client";
import { formString } from "@/lib/form-values";
import { getStoredAuthSession } from "@/lib/vertical-config";

type Tab = "program" | "customers";

interface LoyaltyTier {
  id: string;
  name: string;
  minPoints: number;
  multiplier: number | string;
  color: string;
}

interface LoyaltyCustomer {
  id: string;
  name: string;
  phone: string;
  points: number;
  lastEarnDate: string | null;
  tier: LoyaltyTier | null;
}

interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export function LoyaltyClient() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("program");
  const [customerPage, setCustomerPage] = useState(1);
  const [customerSearch, setCustomerSearch] = useState("");
  const [adjustingCustomer, setAdjustingCustomer] = useState<LoyaltyCustomer | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const role = getStoredAuthSession()?.user?.role;
  const canManage = role === "OWNER" || role === "MANAGER";
  const searchTerm = customerSearch.trim();

  const tiersQuery = useQuery({
    queryKey: ["loyalty-tiers"],
    queryFn: () => createAuthenticatedApiClient().get<LoyaltyTier[]>("/loyalty/tiers"),
  });
  const customersQuery = useQuery({
    queryKey: ["loyalty-customers", customerPage, searchTerm],
    queryFn: () => createAuthenticatedApiClient().get<Paginated<LoyaltyCustomer>>(`/loyalty/customers?page=${String(customerPage)}&limit=25${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ""}`),
    enabled: tab === "customers",
  });
  const createTier = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/loyalty/tiers", payload),
    onSuccess: async () => {
      setMessage("Loyalty tier saved.");
      await queryClient.invalidateQueries({ queryKey: ["loyalty-tiers"] });
    },
  });
  const updateTier = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/loyalty/tiers/${id}`, payload),
    onSuccess: async () => {
      setMessage("Loyalty tier updated.");
      await queryClient.invalidateQueries({ queryKey: ["loyalty-tiers"] });
      await queryClient.invalidateQueries({ queryKey: ["loyalty-customers"] });
    },
  });
  const deleteTier = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/loyalty/tiers/${id}`),
    onSuccess: async () => {
      setMessage("Loyalty tier deleted.");
      await queryClient.invalidateQueries({ queryKey: ["loyalty-tiers"] });
    },
  });
  const adjustPoints = useMutation({
    mutationFn: ({ customerId, payload }: { customerId: string; payload: object }) => createAuthenticatedApiClient().post(`/loyalty/admin-adjust/${customerId}`, payload),
    onSuccess: async () => {
      setMessage("Points adjusted.");
      setAdjustingCustomer(null);
      await queryClient.invalidateQueries({ queryKey: ["loyalty-customers"] });
    },
  });
  const error = tiersQuery.error ?? customersQuery.error ?? createTier.error ?? updateTier.error ?? deleteTier.error ?? adjustPoints.error;

  function handleCreateTier(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    createTier.mutate({
      name: formString(form, "name"),
      minPoints: Number(form.get("minPoints")),
      multiplier: Number(form.get("multiplier")),
      color: formString(form, "color") || "#6b7280",
    });
    event.currentTarget.reset();
  }

  function handleTierUpdate(event: React.SyntheticEvent<HTMLFormElement>, tierId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    updateTier.mutate({
      id: tierId,
      payload: {
        name: formString(form, "name"),
        minPoints: Number(form.get("minPoints")),
        multiplier: Number(form.get("multiplier")),
        color: formString(form, "color") || "#6b7280",
      },
    });
  }

  function handleAdjustment(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustingCustomer) return;
    const form = new FormData(event.currentTarget);
    setMessage(null);
    adjustPoints.mutate({
      customerId: adjustingCustomer.id,
      payload: {
        points: Number(form.get("points")),
        reason: formString(form, "reason"),
      },
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-950">Loyalty</h1>
        <p className="text-sm text-slate-500">Manage tiers, balances, manual adjustments, and expiring points.</p>
      </div>
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

      <div className="flex gap-2 border-b border-border">
        {[
          { id: "program" as const, label: "Program" },
          { id: "customers" as const, label: "Customers" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`px-4 py-2 text-sm font-medium ${tab === item.id ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "program" ? (
        <section className="rounded-md border border-border bg-white">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Tiers</div>
          <div className="divide-y divide-border">
            {tiersQuery.isLoading ? <div className="p-4 text-sm text-slate-500">Loading tiers...</div> : null}
            {(tiersQuery.data ?? []).map((tier) => (
              <form key={tier.id} className="grid gap-3 p-4 md:grid-cols-[1fr_120px_120px_90px_auto]" onSubmit={(event) => handleTierUpdate(event, tier.id)}>
                <input name="name" defaultValue={tier.name} className="h-10 rounded-md border border-border px-3 text-sm" />
                <input name="minPoints" type="number" min="0" defaultValue={tier.minPoints} className="h-10 rounded-md border border-border px-3 text-sm" />
                <input name="multiplier" type="number" min="0.1" step="0.01" defaultValue={String(tier.multiplier)} className="h-10 rounded-md border border-border px-3 text-sm" />
                <input name="color" type="color" defaultValue={tier.color} className="h-10 rounded-md border border-border px-2" />
                <div className="flex gap-2">
                  <button type="submit" disabled={!canManage} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700 disabled:opacity-40">
                    <Save className="size-4" aria-hidden="true" />
                    Save
                  </button>
                  <button type="button" disabled={!canManage} onClick={() => deleteTier.mutate(tier.id)} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 disabled:opacity-40">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </form>
            ))}
            {(tiersQuery.data ?? []).length === 0 && !tiersQuery.isLoading ? <div className="p-4 text-sm text-slate-500">No tiers yet. Add Silver, Gold, or Platinum to start.</div> : null}
          </div>
          {canManage ? (
            <form className="grid gap-3 border-t border-border bg-slate-50 p-4 md:grid-cols-[1fr_120px_120px_90px_auto]" onSubmit={handleCreateTier}>
              <input name="name" placeholder="Tier name" className="h-10 rounded-md border border-border px-3 text-sm" required />
              <input name="minPoints" type="number" min="0" placeholder="Min points" className="h-10 rounded-md border border-border px-3 text-sm" required />
              <input name="multiplier" type="number" min="0.1" step="0.01" defaultValue="1" className="h-10 rounded-md border border-border px-3 text-sm" required />
              <input name="color" type="color" defaultValue="#6b7280" className="h-10 rounded-md border border-border px-2" />
              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white">
                <Plus className="size-4" aria-hidden="true" />
                Add tier
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {tab === "customers" ? (
        <section className="rounded-md border border-border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="text-sm font-semibold text-slate-950">Customer points</div>
            <input
              value={customerSearch}
              onChange={(event) => {
                setCustomerPage(1);
                setCustomerSearch(event.target.value);
              }}
              placeholder="Search name or phone"
              className="h-9 w-full rounded-md border border-border px-3 text-sm md:w-72"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-left font-medium">Tier</th>
                  <th className="px-4 py-2 text-right font-medium">Points</th>
                  <th className="px-4 py-2 text-right font-medium">Last earn</th>
                  <th className="px-4 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(customersQuery.data?.data ?? []).map((customer) => (
                  <tr key={customer.id}>
                    <td className="px-4 py-2"><span className="font-medium">{customer.name}</span><span className="block text-xs text-slate-400">{customer.phone}</span></td>
                    <td className="px-4 py-2">{customer.tier ? <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor: `${customer.tier.color}22`, color: customer.tier.color }}>{customer.tier.name}</span> : "-"}</td>
                    <td className="px-4 py-2 text-right font-semibold text-emerald-700">{customer.points.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right">{customer.lastEarnDate ? new Date(customer.lastEarnDate).toLocaleDateString("en-IN") : "-"}</td>
                    <td className="px-4 py-2 text-right">
                      <button disabled={!canManage} onClick={() => setAdjustingCustomer(customer)} className="h-9 rounded-md border border-border px-3 text-sm font-medium text-slate-700 disabled:opacity-40">Adjust</button>
                    </td>
                  </tr>
                ))}
                {customersQuery.isLoading ? <tr><td className="px-4 py-4 text-sm text-slate-500" colSpan={5}>Loading customers...</td></tr> : null}
                {!customersQuery.isLoading && (customersQuery.data?.data ?? []).length === 0 ? <tr><td className="px-4 py-4 text-sm text-slate-500" colSpan={5}>No loyalty customers found.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <PaginationControls page={customerPage} limit={25} total={customersQuery.data?.total ?? 0} onPageChange={setCustomerPage} />
        </section>
      ) : null}

      {adjustingCustomer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form className="w-full max-w-md rounded-md bg-white p-4 shadow-xl" onSubmit={handleAdjustment}>
            <div className="text-sm font-semibold text-slate-950">Adjust points - {adjustingCustomer.name}</div>
            <div className="mt-1 text-xs text-slate-500">Use positive points to add and negative points to deduct.</div>
            <div className="mt-4 grid gap-3">
              <input name="points" type="number" placeholder="Points e.g. 100 or -50" className="h-10 rounded-md border border-border px-3 text-sm" required />
              <input name="reason" placeholder="Reason" className="h-10 rounded-md border border-border px-3 text-sm" required />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAdjustingCustomer(null)} className="h-10 rounded-md border border-border px-4 text-sm font-medium text-slate-700">Cancel</button>
              <button className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white" disabled={adjustPoints.isPending}>Save adjustment</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
