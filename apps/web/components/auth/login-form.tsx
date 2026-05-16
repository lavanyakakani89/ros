"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { login } from "@/lib/api-client";
import { storeAuthSession } from "@/lib/vertical-config";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      const auth = await login({
        tenantSlug: getFormString(form, "tenantSlug"),
        identifier: getFormString(form, "identifier"),
        password: getFormString(form, "password"),
      });
      storeAuthSession(auth);
      router.push(auth.user.role === "DELIVERY" ? "/delivery-app" : auth.user.role === "STAFF" ? "/billing" : "/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium text-slate-700">
        Shop slug
        <input name="tenantSlug" className="mt-1 h-10 w-full rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="your-shop-slug" required />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Username or email
        <input name="identifier" className="mt-1 h-10 w-full rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="owner or owner@example.com" autoComplete="username" required />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input name="password" className="mt-1 h-10 w-full rounded-md border border-border px-3 outline-none focus:border-emerald-600" type="password" required />
      </label>
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <button className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-semibold text-white" disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Sign in
      </button>
    </form>
  );
}

function getFormString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
