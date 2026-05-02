import Link from "next/link";

import { OnboardingPicker } from "@/components/auth/onboarding-picker";

export default function OnboardingPage() {
  return (
    <main className="min-h-screen bg-surface px-4 py-10">
      <section className="mx-auto max-w-3xl">
        <div className="mb-6">
          <div className="text-sm font-semibold text-emerald-700">RetailOS onboarding</div>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Choose your business type</h1>
        </div>
        <OnboardingPicker />
        <Link href="/login" className="mt-5 block text-sm font-medium text-emerald-700">Back to sign in</Link>
      </section>
    </main>
  );
}
