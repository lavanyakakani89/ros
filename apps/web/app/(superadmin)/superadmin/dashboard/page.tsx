"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SuperAdminPanel, type SuperAdminIdentity } from "@/components/superadmin/superadmin-panel";

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001/api" : "/api");

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<SuperAdminIdentity | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      const response = await fetch(`${apiBaseUrl}/superadmin/auth/me`, {
        credentials: "include",
      });

      if (!response.ok) {
        router.replace("/superadmin/login");
        return;
      }

      const body = (await response.json()) as { admin: SuperAdminIdentity };
      if (active) {
        setAdmin(body.admin);
      }
    }

    void loadSession();

    return () => {
      active = false;
    };
  }, [router]);

  if (!admin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-medium text-slate-300">
        Loading super-admin
      </main>
    );
  }

  return <SuperAdminPanel admin={admin} />;
}
