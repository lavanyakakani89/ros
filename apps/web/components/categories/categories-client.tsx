"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface Category {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  parent?: { name: string } | null;
  children?: Category[];
  _count?: { products: number };
}

export function CategoriesClient() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => createAuthenticatedApiClient().get<Category[]>("/categories"),
  });

  const createCategory = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post("/categories", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      setName(""); setDescription(""); setParentId("");
    },
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().delete(`/categories/${id}`),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });

  const categories = categoriesQuery.data ?? [];
  const rootCategories = categories.filter((c) => !c.parentId);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createCategory.mutate({ name, description: description || undefined, parentId: parentId || undefined });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-950">Product Categories</h1>

      <form onSubmit={handleSubmit} className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Create category</div>
        <div className="flex flex-wrap gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" required className="h-10 flex-1 min-w-[160px] rounded-md border border-border px-3 text-sm" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="h-10 flex-1 min-w-[160px] rounded-md border border-border px-3 text-sm" />
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-10 rounded-md border border-border px-3 text-sm">
            <option value="">Root category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit" disabled={createCategory.isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            <Plus className="size-4" />Add
          </button>
        </div>
      </form>

      <div className="rounded-md border border-border bg-white">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Categories ({categories.length})</div>
        {categories.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No categories yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {rootCategories.map((cat) => (
              <CategoryRow key={cat.id} category={cat} depth={0} allCategories={categories} onDelete={(id) => deleteCategory.mutate(id)} />
            ))}
            {categories.filter((c) => c.parentId && !rootCategories.find((r) => r.id === c.parentId)).map((cat) => (
              <CategoryRow key={cat.id} category={cat} depth={1} allCategories={categories} onDelete={(id) => deleteCategory.mutate(id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryRow({ category, depth, allCategories, onDelete }: {
  category: Category;
  depth: number;
  allCategories: Category[];
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const children = allCategories.filter((c) => c.parentId === category.id);
  const idLabel = depth > 0 ? "Sub Category ID" : "Category ID";

  async function copyId() {
    await navigator.clipboard.writeText(category.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3" style={{ paddingLeft: `${String(16 + depth * 24)}px` }}>
        <div className="flex items-center gap-2">
          {depth > 0 && <ChevronRight className="size-3 text-slate-400" />}
          <div>
            <div className="text-sm font-medium text-slate-900">{category.name}</div>
            {category.description && <div className="text-xs text-slate-500">{category.description}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{category._count?.products ?? 0} products</span>
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{idLabel}: {category.id}</span>
              <button type="button" onClick={() => void copyId()} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy ID"}
              </button>
            </div>
          </div>
        </div>
        <button onClick={() => onDelete(category.id)} className="text-red-400 hover:text-red-600">
          <Trash2 className="size-4" />
        </button>
      </div>
      {children.map((child) => (
        <CategoryRow key={child.id} category={child} depth={depth + 1} allCategories={allCategories} onDelete={onDelete} />
      ))}
    </>
  );
}
