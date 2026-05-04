"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, Trash2 } from "lucide-react";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface Coupon {
  id: string;
  code: string;
  description?: string | null;
  discountType: "FLAT" | "PERCENTAGE";
  discountValue: number | string;
  minOrderValue?: number | string | null;
  usageLimit?: number | null;
  usedCount: number;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}

export function CouponsClient() {
  const queryClient = useQueryClient();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ code: "", description: "", discountType: "FLAT" as "FLAT" | "PERCENTAGE", discountValue: "", minOrderValue: "", usageLimit: "", validUntil: tomorrow });

  const couponsQuery = useQuery({ queryKey: ["coupons"], queryFn: () => createAuthenticatedApiClient().get<Coupon[]>("/coupons") });
  const createCoupon = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/coupons", payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["coupons"] }); setForm({ code: "", description: "", discountType: "FLAT", discountValue: "", minOrderValue: "", usageLimit: "", validUntil: tomorrow }); },
  });
  const deleteCoupon = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/coupons/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["coupons"] }),
  });

  const coupons = couponsQuery.data ?? [];

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!form.code || !form.discountValue) return;
    createCoupon.mutate({
      code: form.code,
      description: form.description || undefined,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      minOrderValue: form.minOrderValue ? Number(form.minOrderValue) : undefined,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
      validUntil: new Date(form.validUntil).toISOString(),
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-950">Coupons & Discount Codes</h1>

      <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Create coupon</div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="Coupon code (e.g. SAVE20)" required className="h-10 rounded-md border border-border px-3 text-sm font-mono uppercase" />
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-10 rounded-md border border-border px-3 text-sm" />
          <select value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as "FLAT" | "PERCENTAGE" }))} className="h-10 rounded-md border border-border px-3 text-sm">
            <option value="FLAT">Flat (₹)</option>
            <option value="PERCENTAGE">Percentage (%)</option>
          </select>
          <input type="number" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} placeholder={`Discount ${form.discountType === "FLAT" ? "amount (₹)" : "percentage"}`} required min="0" className="h-10 rounded-md border border-border px-3 text-sm" />
          <input type="number" value={form.minOrderValue} onChange={(e) => setForm((f) => ({ ...f, minOrderValue: e.target.value }))} placeholder="Min order value (optional)" min="0" className="h-10 rounded-md border border-border px-3 text-sm" />
          <input type="number" value={form.usageLimit} onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))} placeholder="Usage limit (optional)" min="1" step="1" className="h-10 rounded-md border border-border px-3 text-sm" />
          <input type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} required className="h-10 rounded-md border border-border px-3 text-sm" />
        </div>
        <button type="submit" disabled={createCoupon.isPending} className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
          <Plus className="size-4" />Create coupon
        </button>
      </form>

      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Active coupons</div>
        {coupons.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No coupons yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {coupons.map((coupon) => (
              <div key={coupon.id} className={`flex items-center justify-between px-4 py-3 ${!coupon.isActive ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-emerald-50">
                    <Tag className="size-4 text-emerald-700" />
                  </div>
                  <div>
                    <div className="font-mono text-sm font-bold text-slate-900">{coupon.code}</div>
                    <div className="text-xs text-slate-500">
                      {coupon.discountType === "FLAT" ? `₹${Number(coupon.discountValue).toFixed(0)} off` : `${String(Number(coupon.discountValue))}% off`}
                      {coupon.minOrderValue ? ` · Min ₹${Number(coupon.minOrderValue).toFixed(0)}` : ""}
                      {coupon.usageLimit ? ` · ${String(coupon.usedCount)}/${String(coupon.usageLimit)} used` : ` · ${String(coupon.usedCount)} used`}
                      {" · Expires "}{new Date(coupon.validUntil).toLocaleDateString("en-IN")}
                    </div>
                  </div>
                </div>
                <button onClick={() => deleteCoupon.mutate(coupon.id)} className="text-red-400 hover:text-red-600">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
