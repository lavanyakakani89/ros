"use client";

import type { TenantVertical } from "@retailos/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { registerShop } from "@/lib/api-client";
import { storeAuthSession } from "@/lib/vertical-config";

const verticals: Array<{ value: TenantVertical; label: string }> = [
  { value: "PHARMACY", label: "Pharmacy" },
  { value: "GROCERY", label: "Grocery" },
  { value: "FASHION", label: "Fashion" },
  { value: "HARDWARE", label: "Hardware" },
  { value: "ELECTRONICS", label: "Electronics" },
  { value: "RESTAURANT", label: "Restaurant" },
];

export function RegisterForm({ initialVertical }: Readonly<{ initialVertical: TenantVertical }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const tenantSlug = getFormString(form, "tenantSlug");

    try {
      const auth = await registerShop({
        tenantName: getFormString(form, "tenantName"),
        tenantSlug,
        vertical: getFormString(form, "vertical") as TenantVertical,
        phone: getFormString(form, "phone"),
        ownerName: getFormString(form, "ownerName"),
        ownerEmail: getFormString(form, "ownerEmail"),
        ownerUsername: getFormString(form, "ownerUsername") || undefined,
        ownerPhone: getFormString(form, "phone"),
        password: getFormString(form, "password"),
      });
      storeAuthSession(auth);
      router.push("/billing");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create shop");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
      <input name="tenantName" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="Shop name" required />
      <input name="tenantSlug" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="shop-slug" required />
      <select name="vertical" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600" defaultValue={initialVertical}>
        {verticals.map((vertical) => (
          <option key={vertical.value} value={vertical.value}>{vertical.label}</option>
        ))}
      </select>
      <input name="phone" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="Phone" required />
      <input name="ownerName" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="Owner name" required />
      <input name="ownerEmail" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600" placeholder="Email" type="email" required />
      <input name="ownerUsername" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600 sm:col-span-2" placeholder="Login username (optional, email is used if blank)" autoComplete="username" />
      <input name="password" className="h-10 rounded-md border border-border px-3 outline-none focus:border-emerald-600 sm:col-span-2" placeholder="Password" type="password" minLength={8} required />
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</div> : null}
      <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-semibold text-white sm:col-span-2" disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Continue
      </button>
    </form>
  );
}

function getFormString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
