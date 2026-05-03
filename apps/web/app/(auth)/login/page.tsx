import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <section className="w-full max-w-sm rounded-md border border-border bg-white p-6">
        <div className="text-xl font-semibold text-slate-950">RetailOS</div>
        <div className="mt-1 text-sm text-slate-500">Sign in to your shop</div>
        <LoginForm />
        <div className="mt-4 text-sm text-slate-500">Contact your RetailOS administrator to create a shop account.</div>
      </section>
    </main>
  );
}
