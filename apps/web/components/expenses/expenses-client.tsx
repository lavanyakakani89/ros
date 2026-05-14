"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, X } from "lucide-react";
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

interface ExpenseFormState {
  category: string;
  description: string;
  amount: string;
  paidAt: string;
  notes: string;
}

function toDateInputValue(date: Date | string = new Date()) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 10);
}

export function ExpensesClient() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ category: "Rent", description: "", amount: "", paidAt: toDateInputValue(), notes: "" });
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState(toDateInputValue(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(toDateInputValue());
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editForm, setEditForm] = useState<ExpenseFormState>({ category: "Rent", description: "", amount: "", paidAt: toDateInputValue(), notes: "" });

  const expensesQuery = useQuery({
    queryKey: ["expenses", from, to],
    queryFn: () => createAuthenticatedApiClient().get<{ data: Expense[]; summary: { total: number; byCategory: Record<string, number> } }>(`/expenses?from=${from}&to=${to}&limit=100`),
  });
  const createExpense = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/expenses", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setForm({ category: "Rent", description: "", amount: "", paidAt: toDateInputValue(), notes: "" });
      setMessage("Expense added.");
    },
  });
  const deleteExpense = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/expenses/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
  const updateExpense = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: object }) => createAuthenticatedApiClient().put(`/expenses/${id}`, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setEditingExpense(null);
      setMessage("Expense updated.");
    },
  });

  const expenses = expensesQuery.data?.data ?? [];
  const summary = expensesQuery.data?.summary;

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setMessage("");
    if (!form.description.trim() || !form.amount) return;
    createExpense.mutate({ category: form.category, description: form.description, amount: Number(form.amount), paidAt: form.paidAt, notes: form.notes || undefined });
  }

  function openEdit(expense: Expense) {
    setMessage("");
    setEditingExpense(expense);
    setEditForm({
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      paidAt: toDateInputValue(expense.paidAt),
      notes: expense.notes ?? "",
    });
  }

  function handleEditSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (!editingExpense || !editForm.description.trim() || !editForm.amount) return;
    updateExpense.mutate({
      id: editingExpense.id,
      payload: {
        category: editForm.category,
        description: editForm.description,
        amount: Number(editForm.amount),
        paidAt: editForm.paidAt,
        notes: editForm.notes || undefined,
      },
    });
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
          { label: "Total expenses", value: `₹${summary.total.toFixed(2)}`, tone: "amber" },
          ...Object.entries(summary.byCategory).slice(0, 4).map(([cat, amt]) => ({ label: cat, value: `₹${amt.toFixed(2)}`, tone: "slate" as const })),
        ]} />
      )}

      {/* Add expense form */}
      <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Add expense</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="h-10 rounded-md border border-border px-3 text-sm">
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" required className="h-10 rounded-md border border-border px-3 text-sm" />
          <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount (₹)" required className="h-10 rounded-md border border-border px-3 text-sm" />
          <input type="date" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} required className="h-10 rounded-md border border-border px-3 text-sm" />
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" className="h-10 rounded-md border border-border px-3 text-sm" />
        </div>
        {createExpense.error ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{createExpense.error.message}</div> : null}
        {message ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
        <button type="submit" disabled={createExpense.isPending} className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
          <Plus className="size-4" />Add expense
        </button>
      </form>

      {/* Expense list */}
      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Expense history</div>
        {expensesQuery.error ? <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{expensesQuery.error.message}</div> : null}
        {updateExpense.error ? <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{updateExpense.error.message}</div> : null}
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
                  <span className="font-semibold text-amber-700">₹{Number(expense.amount).toFixed(2)}</span>
                  <button onClick={() => openEdit(expense)} className="inline-flex size-9 items-center justify-center rounded-md border border-border text-slate-600 hover:border-emerald-200 hover:text-emerald-700" title="Edit expense">
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button onClick={() => deleteExpense.mutate(expense.id)} className="inline-flex size-9 items-center justify-center rounded-md border border-red-100 text-red-400 hover:text-red-600" title="Delete expense">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingExpense ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={handleEditSubmit} className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Edit expense</div>
                <div className="text-xs text-slate-500">Update category, amount, paid date, and notes.</div>
              </div>
              <button type="button" onClick={() => setEditingExpense(null)} className="inline-flex size-9 items-center justify-center rounded-md border border-border text-slate-500">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600">
                Category
                <select value={editForm.category} onChange={(event) => setEditForm((current) => ({ ...current, category: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
                  {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600">
                Amount
                <input type="number" min="0.01" step="0.01" value={editForm.amount} onChange={(event) => setEditForm((current) => ({ ...current, amount: event.target.value }))} required className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                Description
                <input value={editForm.description} onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))} required className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Paid at
                <input type="date" value={editForm.paidAt} onChange={(event) => setEditForm((current) => ({ ...current, paidAt: event.target.value }))} required className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Notes
                <input value={editForm.notes} onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
              <button type="button" onClick={() => setEditingExpense(null)} className="h-10 rounded-md border border-border px-4 text-sm font-medium text-slate-700">Cancel</button>
              <button type="submit" disabled={updateExpense.isPending} className="h-10 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50">
                {updateExpense.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
