"use client";

import { XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiUrl } from "@/lib/api-client";
import { storeImpersonation } from "@/lib/impersonation";

interface VerifyImpersonationResponse {
  valid: boolean;
  tenantName: string;
  superAdminEmail: string;
  superAdminName?: string;
  accessLevel: "READ_ONLY" | "WRITE";
  expiresAt: string;
  sessionId: string;
}

export default function ImpersonatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    const token = searchParams?.get("token");
    const sessionId = searchParams?.get("sessionId");

    if (!token || !sessionId) {
      router.replace("/login");
      return;
    }
    const impersonationToken = token;
    const impersonationSessionId = sessionId;

    async function verifyImpersonation() {
      const response = await fetch(apiUrl("/superadmin/impersonate/verify"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: impersonationToken, sessionId: impersonationSessionId }),
      });

      if (!response.ok) {
        throw new Error("Invalid or expired impersonation session");
      }

      const body = (await response.json()) as VerifyImpersonationResponse;
      if (!body.valid) {
        throw new Error("Invalid or expired impersonation session");
      }

      storeImpersonation({
        sessionId: body.sessionId,
        token: impersonationToken,
        tenantName: body.tenantName,
        accessLevel: body.accessLevel,
        reason: null,
        expiresAt: body.expiresAt,
        superAdminEmail: body.superAdminEmail,
        ...(body.superAdminName ? { superAdminName: body.superAdminName } : {}),
      });
      router.replace("/dashboard");
    }

    void verifyImpersonation().catch(() => setError(true));
  }, [router, searchParams]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-md rounded-md border border-red-900 bg-slate-900 p-5 shadow-xl">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 size-5 shrink-0 text-red-300" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-semibold">Invalid or expired impersonation session</h1>
              <button
                className="mt-4 h-9 rounded-md bg-red-500 px-3 text-sm font-semibold text-white"
                onClick={() => window.close()}
              >
                Close tab
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-medium text-slate-200">
      Opening support view
    </main>
  );
}
