"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { StatStrip } from "@/components/shared/stat-strip";
import { createAuthenticatedApiClient } from "@/lib/api-client";

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: string | number;
  paidAt: string;
  notes?: string | null;
}

const EXPENSE_CATEGORIES = ["Rent", "Electricity", "Salaries", "Transport", "Packaging", "Marketing", "Maintenance", "Other"];

export function ExpensesClient() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ category: "Rent", description: "", amount: "", notes: "" });
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const expensesQuery = useQuery({
    queryKey: ["expenses", from, to],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Expense[]; summary: { total: number; byCategory: Record<string, number> } }>(`/expenses?from=${from}&to=${to}&limit=100`),
  });
  const createExpense = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/expenses", payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["expenses"] }); setForm({ category: "Rent", description: "", amount: "", notes: "" }); },
  });
  const deleteExpense = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/expenses/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const expenses = expensesQuery.data?.data ?? [];
  const summary = expensesQuery.data?.summary;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    createExpense.mutate({ category: form.category, description: form.description, amount: Number(form.amount), notes: form.notes || undefined });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-950">Expenses</h1>

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-border px-3 text-sm" /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-border px-3 text-sm" /></label>
      </div>

      {summary && (
        <StatStrip items={[
          { label: "Total expenses", value: `INR ${Number(summary.total).toFixed(2)}`, tone: "amber" },
          ...Object.entries(summary.byCategory).slice(0, 4).map(([cat, amt]) => ({ label: cat, value: `INR ${Number(amt).toFixed(2)}`, tone: "slate" as const })),
        ]} />
      )}

      {/* Add expense form */}
      <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Add expense</div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="h-10 rounded-md border border-border px-3 text-sm">
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" required className="h-10 rounded-md border border-border px-3 text-sm" />
          <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount (INR)" required className="h-10 rounded-md border border-border px-3 text-sm" />
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" className="h-10 rounded-md border border-border px-3 text-sm" />
        </div>
        <button type="submit" disabled={createExpense.isPending} className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
          <Plus className="size-4" />Add expense
        </button>
      </form>

      {/* Expense list */}
      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Expense history</div>
        {expenses.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No expenses recorded.</div>
        ) : (
          <div className="divide-y divide-border">
            {expenses.map((expense) => (
              <div key={expense.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">{expense.description}</div>
                  <div className="text-xs text-slate-500">{expense.category} · {new Date(expense.paidAt).toLocaleDateString("en-IN")}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-amber-700">INR {Number(expense.amount).toFixed(2)}</span>
                  <button onClick={() => deleteExpense.mutate(expense.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
