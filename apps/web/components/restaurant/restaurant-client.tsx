"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Plus, Table, UtensilsCrossed } from "lucide-react";
import { useState } from "react";

import { createAuthenticatedApiClient, listProducts } from "@/lib/api-client";

type TabType = "tables" | "kot" | "menu" | "modifiers";

interface RestaurantTable {
  id: string;
  number: string;
  capacity: number;
  section?: string | null;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "CLEANING";
  kots: Array<{ id: string; status: string }>;
}

interface KOT {
  id: string;
  kotNumber: string;
  status: string;
  createdAt: string;
  table?: { number: string } | null;
  items: Array<{ productName: string; quantity: number | string; notes?: string | null }>;
}

interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  products: Array<{ id: string; name: string; sellingPrice: number | string }>;
}

const TABLE_STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 border-emerald-300 text-emerald-800",
  OCCUPIED: "bg-red-100 border-red-300 text-red-800",
  RESERVED: "bg-amber-100 border-amber-300 text-amber-800",
  CLEANING: "bg-slate-100 border-slate-300 text-slate-700",
};

const KOT_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  PREPARING: "bg-blue-100 text-blue-700",
  READY: "bg-emerald-100 text-emerald-700",
  SERVED: "bg-slate-100 text-slate-500",
  CANCELLED: "bg-red-100 text-red-600",
};

export function RestaurantClient() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabType>("tables");
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("4");
  const [newTableSection, setNewTableSection] = useState("");
  const [newMenuCat, setNewMenuCat] = useState("");
  const [kotTableId, setKotTableId] = useState("");
  const [kotLines, setKotLines] = useState([{ productName: "", quantity: 1, notes: "" }]);

  const tablesQuery = useQuery({ queryKey: ["restaurant-tables"], queryFn: () => createAuthenticatedApiClient().get<RestaurantTable[]>("/restaurant/tables") });
  const kotsQuery = useQuery({ queryKey: ["restaurant-kots"], queryFn: () => createAuthenticatedApiClient().get<KOT[]>("/restaurant/kots?status=PENDING,PREPARING,READY"), enabled: tab === "kot" });
  const menuCatsQuery = useQuery({ queryKey: ["restaurant-menu-cats"], queryFn: () => createAuthenticatedApiClient().get<MenuCategory[]>("/restaurant/menu-categories"), enabled: tab === "menu" });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => listProducts(), enabled: tab === "kot" });

  const createTable = useMutation({
    mutationFn: (p: object) => createAuthenticatedApiClient().post("/restaurant/tables", p),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] }); setNewTableNumber(""); },
  });
  const updateTableStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => createAuthenticatedApiClient().put(`/restaurant/tables/${id}/status`, { status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["restaurant-tables"] }),
  });
  const createKot = useMutation({
    mutationFn: (p: object) => createAuthenticatedApiClient().post("/restaurant/kots", p),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["restaurant-kots"] }); setKotLines([{ productName: "", quantity: 1, notes: "" }]); },
  });
  const updateKotStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => createAuthenticatedApiClient().put(`/restaurant/kots/${id}/status`, { status }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["restaurant-kots"] }),
  });
  const createMenuCat = useMutation({
    mutationFn: (p: object) => createAuthenticatedApiClient().post("/restaurant/menu-categories", p),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["restaurant-menu-cats"] }); setNewMenuCat(""); },
  });

  const tables = tablesQuery.data ?? [];
  const kots = kotsQuery.data ?? [];
  const menuCats = menuCatsQuery.data ?? [];
  const products = productsQuery.data?.data ?? [];

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: "tables", label: "Tables", icon: Table },
    { id: "kot", label: "Kitchen (KOT)", icon: ChefHat },
    { id: "menu", label: "Menu Categories", icon: UtensilsCrossed },
  ];

  function handleKotSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const items = kotLines.filter((l) => l.productName.trim());
    if (items.length === 0) return;
    createKot.mutate({ tableId: kotTableId || undefined, items });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-950">Restaurant</h1>
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500"}`}>
            <t.icon className="size-4" />{t.label}
          </button>
        ))}
      </div>

      {/* TABLES */}
      {tab === "tables" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 rounded-md border border-border bg-white p-4">
            <input value={newTableNumber} onChange={(e) => setNewTableNumber(e.target.value)} placeholder="Table number" className="h-10 rounded-md border border-border px-3 text-sm w-32" />
            <input type="number" value={newTableCapacity} onChange={(e) => setNewTableCapacity(e.target.value)} placeholder="Capacity" min="1" className="h-10 rounded-md border border-border px-3 text-sm w-24" />
            <input value={newTableSection} onChange={(e) => setNewTableSection(e.target.value)} placeholder="Section (e.g. Indoor)" className="h-10 rounded-md border border-border px-3 text-sm w-40" />
            <button onClick={() => createTable.mutate({ number: newTableNumber, capacity: Number(newTableCapacity), section: newTableSection || undefined })} disabled={!newTableNumber}
              className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
              <Plus className="inline size-4 mr-1" />Add table
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {tables.map((t) => (
              <div key={t.id} className={`rounded-md border-2 p-3 ${TABLE_STATUS_COLORS[t.status] ?? ""}`}>
                <div className="text-lg font-bold">T{t.number}</div>
                <div className="text-xs">{t.section ?? "Main"} · {t.capacity} seats</div>
                <div className="text-xs mt-1 font-medium">{t.status}</div>
                {t.status !== "AVAILABLE" && (
                  <button onClick={() => updateTableStatus.mutate({ id: t.id, status: "AVAILABLE" })} className="mt-2 text-xs underline">Mark free</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KOT */}
      {tab === "kot" && (
        <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
          <form onSubmit={handleKotSubmit} className="rounded-md border border-border bg-white p-4 space-y-3">
            <div className="text-sm font-semibold">New KOT</div>
            <select value={kotTableId} onChange={(e) => setKotTableId(e.target.value)} className="h-10 w-full rounded-md border border-border px-3 text-sm">
              <option value="">No table (takeaway)</option>
              {tables.map((t) => <option key={t.id} value={t.id}>Table {t.number}</option>)}
            </select>
            {kotLines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <select value={line.productName} onChange={(e) => {
                  const product = products.find((p) => p.id === e.target.value);
                  setKotLines((prev) => prev.map((l, i) => i === idx ? { ...l, productName: product?.name ?? e.target.value } : l));
                }} className="h-9 flex-1 rounded-md border border-border px-2 text-sm">
                  <option value="">Select item</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input type="number" min="0.5" step="0.5" value={line.quantity} onChange={(e) => setKotLines((prev) => prev.map((l, i) => i === idx ? { ...l, quantity: Number(e.target.value) } : l))} className="h-9 w-16 rounded-md border border-border px-2 text-sm" />
                <input value={line.notes} onChange={(e) => setKotLines((prev) => prev.map((l, i) => i === idx ? { ...l, notes: e.target.value } : l))} placeholder="Notes" className="h-9 w-24 rounded-md border border-border px-2 text-sm" />
                {idx > 0 && <button type="button" onClick={() => setKotLines((prev) => prev.filter((_, i) => i !== idx))} className="text-red-500">✕</button>}
              </div>
            ))}
            <button type="button" onClick={() => setKotLines((p) => [...p, { productName: "", quantity: 1, notes: "" }])} className="text-sm text-emerald-700">+ Add item</button>
            <button type="submit" disabled={createKot.isPending} className="w-full h-10 rounded-md bg-emerald-600 text-sm font-medium text-white">Fire KOT</button>
          </form>
          <div className="space-y-3">
            {["PENDING", "PREPARING", "READY"].map((statusGroup) => (
              <div key={statusGroup}>
                <div className={`mb-2 text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-md inline-block ${KOT_STATUS_COLORS[statusGroup] ?? ""}`}>{statusGroup}</div>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {kots.filter((k) => k.status === statusGroup).map((kot) => (
                    <div key={kot.id} className="rounded-md border border-border bg-white p-3">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-sm font-bold">{kot.kotNumber}</span>
                        {kot.table && <span className="text-xs text-slate-500">T{kot.table.number}</span>}
                      </div>
                      <div className="space-y-1 mb-3">
                        {kot.items.map((item, i) => (
                          <div key={i} className="text-sm">{Number(item.quantity)}× {item.productName}{item.notes ? ` (${item.notes})` : ""}</div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        {statusGroup === "PENDING" && <button onClick={() => updateKotStatus.mutate({ id: kot.id, status: "PREPARING" })} className="flex-1 h-8 rounded-md bg-blue-600 text-xs font-medium text-white">Preparing</button>}
                        {statusGroup === "PREPARING" && <button onClick={() => updateKotStatus.mutate({ id: kot.id, status: "READY" })} className="flex-1 h-8 rounded-md bg-emerald-600 text-xs font-medium text-white">Ready</button>}
                        {statusGroup === "READY" && <button onClick={() => updateKotStatus.mutate({ id: kot.id, status: "SERVED" })} className="flex-1 h-8 rounded-md bg-slate-600 text-xs font-medium text-white">Served</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MENU CATEGORIES */}
      {tab === "menu" && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input value={newMenuCat} onChange={(e) => setNewMenuCat(e.target.value)} placeholder="New category name" className="h-10 rounded-md border border-border px-3 text-sm w-56" />
            <button onClick={() => createMenuCat.mutate({ name: newMenuCat })} disabled={!newMenuCat} className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">Add</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {menuCats.map((cat) => (
              <div key={cat.id} className="rounded-md border border-border bg-white p-4">
                <div className="mb-2 font-semibold text-slate-950">{cat.name}</div>
                <div className="space-y-1">
                  {cat.products.map((p) => (
                    <div key={p.id} className="flex justify-between text-sm">
                      <span className="text-slate-700">{p.name}</span>
                      <span className="text-slate-500">INR {Number(p.sellingPrice).toFixed(2)}</span>
                    </div>
                  ))}
                  {cat.products.length === 0 && <div className="text-xs text-slate-400">No items — assign via Inventory</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
