"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  changes?: unknown;
  ip?: string | null;
  createdAt: string;
}

const ENTITIES = ["", "invoice", "product", "customer", "supplier", "user", "expense", "coupon", "credit_note"];

export function AuditClient() {
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);

  const logsQuery = useQuery({
    queryKey: ["audit-logs", entity, page],
    queryFn: () => createAuthenticatedApiClient().get<{ data: AuditLog[]; total: number; limit: number }>(`/audit-logs?page=${page}&limit=50${entity ? `&entity=${entity}` : ""}`),
  });

  const logs = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.total ?? 0;
  const limit = logsQuery.data?.limit ?? 50;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-950">Audit Log</h1>
      <div className="flex gap-3">
        <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="h-10 rounded-md border border-border px-3 text-sm">
          <option value="">All entities</option>
          {ENTITIES.filter(Boolean).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="text-sm text-slate-500 self-center">{total} records</span>
      </div>
      <div className="rounded-md border border-border bg-white">
        {logs.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No audit logs yet. Actions will be recorded here.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">User</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-left font-medium">Entity</th>
                  <th className="px-4 py-2 text-left font-medium">ID</th>
                  <th className="px-4 py-2 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(log.createdAt).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-xs font-mono">{log.userId.slice(-8)}</td>
                    <td className="px-4 py-2"><span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{log.action}</span></td>
                    <td className="px-4 py-2 text-xs">{log.entity}</td>
                    <td className="px-4 py-2 text-xs font-mono text-slate-400">{log.entityId?.slice(-8) ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">{log.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > limit && (
          <div className="flex justify-between border-t border-border px-4 py-3">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="text-sm text-emerald-700 disabled:opacity-40">← Previous</button>
            <span className="text-sm text-slate-500">Page {page} of {Math.ceil(total / limit)}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / limit)} className="text-sm text-emerald-700 disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
