"use client";

import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-surface px-4">
          <section className="w-full max-w-md rounded-md border border-border bg-white p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-md bg-red-100 text-red-700">
              <AlertTriangle className="size-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-slate-950">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">
              BizBil could not load this screen. Try again, or return to the dashboard.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white"
              >
                Try again
              </button>
              <a
                href="/dashboard"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700"
              >
                Dashboard
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
