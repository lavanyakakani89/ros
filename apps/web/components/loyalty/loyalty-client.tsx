"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface LoyaltyAccount {
  id: string;
  points: number;
  customer: { id: string; name: string; phone: string };
}

interface LoyaltyTransaction {
  id: string;
  type: string;
  points: number;
  createdAt: string;
  invoice?: { invoiceNumber: string } | null;
}

export function LoyaltyClient() {
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const customersQuery = useQuery({
    queryKey: ["customers", "loyalty-search", search],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Array<{ id: string; name: string; phone: string }> }>(`/customers?limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}`),
    enabled: search.length > 1,
  });

  const ledgerQuery = useQuery({
    queryKey: ["loyalty-ledger", selectedCustomerId],
    queryFn: () => {
      if (!selectedCustomerId) {
        throw new Error("Select a customer before loading loyalty transactions.");
      }

      return createAuthenticatedApiClient().get<{ account: LoyaltyAccount; transactions: LoyaltyTransaction[] }>(`/loyalty/${selectedCustomerId}/transactions`);
    },
    enabled: !!selectedCustomerId,
  });

  const customers = customersQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-950">Loyalty Points</h1>

      <div className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Look up customer</div>
        <div className="flex gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone" className="h-10 flex-1 rounded-md border border-border px-3 text-sm" />
        </div>
        {customers.length > 0 && (
          <div className="mt-2 divide-y divide-border rounded-md border border-border">
            {customers.map((c) => (
              <button key={c.id} onClick={() => { setSelectedCustomerId(c.id); setSearch(""); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span>{c.name}</span>
                <span className="text-xs text-slate-400">{c.phone}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedCustomerId && ledgerQuery.data && (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">{ledgerQuery.data.account.customer.name}</div>
                <div className="text-xs text-slate-500">{ledgerQuery.data.account.customer.phone}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-emerald-700">{ledgerQuery.data.account.points.toLocaleString("en-IN")}</div>
                <div className="text-xs text-slate-500">points available</div>
                <div className="text-xs text-slate-400">≈ INR {ledgerQuery.data.account.points.toLocaleString("en-IN")} value</div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-white">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Transaction history</div>
            {ledgerQuery.data.transactions.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">No transactions yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-left font-medium">Type</th>
                    <th className="px-4 py-2 text-left font-medium">Invoice</th>
                    <th className="px-4 py-2 text-right font-medium">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ledgerQuery.data.transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="px-4 py-2 text-xs text-slate-500">{new Date(tx.createdAt).toLocaleDateString("en-IN")}</td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tx.type === "EARN" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{tx.invoice?.invoiceNumber ?? "—"}</td>
                      <td className={`px-4 py-2 text-right font-semibold ${tx.type === "EARN" ? "text-emerald-700" : "text-orange-700"}`}>
                        {tx.type === "EARN" ? "+" : "−"}{tx.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
