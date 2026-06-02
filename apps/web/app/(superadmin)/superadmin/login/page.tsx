"use client";

import { useRouter } from "next/navigation";
import type { SyntheticEvent } from "react";
import { useState } from "react";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${apiBaseUrl}/superadmin/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Super-admin login failed");
      }

      router.replace("/superadmin/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Super-admin login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <section className="w-full max-w-sm rounded-md border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center overflow-hidden rounded-md bg-white">
            <img src="/bizbil-landing/icons/bizbil-mark.png" alt="BizBil" className="h-full w-full object-contain" />
          </div>
          <div>
            <img src="/bizbil-landing/icons/bizbil-wordmark.png" alt="BizBil" className="h-5 w-auto object-contain" />
            <div className="text-xs text-slate-400">Super Admin</div>
          </div>
        </div>
        <div className="mt-1 text-sm text-slate-400">Manage shops, licenses, and access.</div>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-200">
            Email
            <input
              className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-500"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Password
            <input
              className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-500"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <div className="rounded-md border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          <button
            className="h-10 w-full rounded-md bg-emerald-500 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
