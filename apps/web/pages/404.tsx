export default function PageNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-md rounded-md border border-border bg-white p-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">The page may have moved, or you may not have access to it.</p>
        <a href="/dashboard" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white">
          Open dashboard
        </a>
      </section>
    </main>
  );
}
