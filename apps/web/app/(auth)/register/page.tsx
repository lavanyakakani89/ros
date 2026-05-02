import Link from "next/link";
import type { TenantVertical } from "@retailos/shared";

import { RegisterForm } from "@/components/auth/register-form";

const verticals: TenantVertical[] = ["PHARMACY", "GROCERY", "FASHION", "HARDWARE", "ELECTRONICS", "RESTAURANT"];

export default function RegisterPage({
  searchParams,
}: Readonly<{
  searchParams: { vertical?: string };
}>) {
  const selectedVertical = verticals.includes(searchParams.vertical as TenantVertical) ? (searchParams.vertical as TenantVertical) : "PHARMACY";

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-lg rounded-md border border-border bg-white p-6">
        <div className="text-xl font-semibold text-slate-950">Create RetailOS shop</div>
        <RegisterForm initialVertical={selectedVertical} />
        <Link href="/login" className="mt-4 block text-sm font-medium text-emerald-700">Back to sign in</Link>
      </section>
    </main>
  );
}
