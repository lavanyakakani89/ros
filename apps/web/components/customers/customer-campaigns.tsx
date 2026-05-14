"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Plus, Send, X } from "lucide-react";
import { useEffect, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { getStoredAuthSession } from "@/lib/vertical-config";

type TargetType = "ALL" | "TAG" | "OUTSTANDING" | "LOYALTY_TIER";

interface CampaignSummary {
  id: string;
  name: string;
  message: string;
  status: string;
  targetType: TargetType;
  targetValue: string | null;
  sentCount: number;
  failCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  _count?: {
    recipients: number;
  };
}

interface CampaignDetail extends CampaignSummary {
  recipients: Array<{
    id: string;
    customerName: string | null;
    phone: string;
    status: string;
    error: string | null;
    sentAt: string | null;
  }>;
}

export function CustomerCampaigns() {
  const queryClient = useQueryClient();
  const role = getStoredAuthSession()?.user?.role;
  const canManage = role === "OWNER" || role === "MANAGER";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const campaignsQuery = useQuery({
    queryKey: ["whatsapp-campaigns"],
    queryFn: () => createAuthenticatedApiClient().get<CampaignSummary[]>("/whatsapp/campaigns"),
  });
  const detailQuery = useQuery({
    queryKey: ["whatsapp-campaign", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => createAuthenticatedApiClient().get<CampaignDetail>(`/whatsapp/campaigns/${selectedId ?? ""}`),
  });
  const sendCampaign = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/whatsapp/campaigns/${id}/send`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["whatsapp-campaigns"] }),
        queryClient.invalidateQueries({ queryKey: ["whatsapp-campaign", selectedId] }),
      ]);
    },
  });
  const cancelCampaign = useMutation({
    mutationFn: (id: string) => createAuthenticatedApiClient().post(`/whatsapp/campaigns/${id}/cancel`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["whatsapp-campaigns"] }),
        queryClient.invalidateQueries({ queryKey: ["whatsapp-campaign", selectedId] }),
      ]);
    },
  });

  const campaigns = campaignsQuery.data ?? [];
  const selectedCampaign = detailQuery.data ?? null;
  const pageError = campaignsQuery.error ?? detailQuery.error ?? sendCampaign.error ?? cancelCampaign.error;

  useEffect(() => {
    if (!selectedId && campaigns[0]) {
      setSelectedId(campaigns[0].id);
    }
  }, [campaigns, selectedId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">WhatsApp campaigns</h2>
          <p className="text-sm text-slate-500">Send customer updates, due reminders, and shop announcements from one place.</p>
        </div>
        {canManage ? (
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New campaign
          </button>
        ) : null}
      </div>

      {pageError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{pageError.message}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-md border border-border bg-white">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-950">Campaigns</div>
          {campaignsQuery.isLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-md bg-slate-100" />)}</div>
          ) : campaigns.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No campaigns yet.</div>
          ) : (
            <div className="max-h-[620px] overflow-y-auto">
              {campaigns.map((campaign) => (
                <button key={campaign.id} type="button" className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-slate-50 ${selectedId === campaign.id ? "bg-emerald-50" : "bg-white"}`} onClick={() => setSelectedId(campaign.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{campaign.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{campaign.targetType.replace("_", " ")} · {campaign._count?.recipients ?? 0} recipients</div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${campaignStatusClass(campaign.status)}`}>{campaign.status}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">Sent {campaign.sentCount} · Failed {campaign.failCount}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border border-border bg-white">
          {!selectedCampaign ? (
            <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-500">Select a campaign.</div>
          ) : (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-950">{selectedCampaign.name}</div>
                    <div className="mt-1 text-xs text-slate-500">Created {new Date(selectedCampaign.createdAt).toLocaleString("en-IN")}</div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${campaignStatusClass(selectedCampaign.status)}`}>{selectedCampaign.status}</span>
                </div>
                <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">{selectedCampaign.message}</div>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={sendCampaign.isPending || !["DRAFT", "SENDING"].includes(selectedCampaign.status)} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50" onClick={() => sendCampaign.mutate(selectedCampaign.id)}>
                      <Send className="size-4" aria-hidden="true" />
                      Send now
                    </button>
                    <button type="button" disabled={cancelCampaign.isPending || !["DRAFT", "SENDING"].includes(selectedCampaign.status)} className="h-10 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-50" onClick={() => cancelCampaign.mutate(selectedCampaign.id)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
                <MetricCard label="Recipients" value={String(selectedCampaign.recipients.length)} />
                <MetricCard label="Sent" value={String(selectedCampaign.sentCount)} />
                <MetricCard label="Failed" value={String(selectedCampaign.failCount)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Customer</th>
                      <th className="px-4 py-2 text-left font-medium">Phone</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Sent at</th>
                      <th className="px-4 py-2 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedCampaign.recipients.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">No recipients queued yet.</td></tr>
                    ) : selectedCampaign.recipients.map((recipient) => (
                      <tr key={recipient.id}>
                        <td className="px-4 py-2 font-medium">{recipient.customerName ?? "Customer"}</td>
                        <td className="px-4 py-2">{recipient.phone}</td>
                        <td className="px-4 py-2">{recipient.status}</td>
                        <td className="px-4 py-2">{recipient.sentAt ? new Date(recipient.sentAt).toLocaleString("en-IN") : "-"}</td>
                        <td className="px-4 py-2 text-red-700">{recipient.error ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {showCreate ? <CampaignCreateDialog onClose={() => setShowCreate(false)} onCreated={(id) => { setSelectedId(id); setShowCreate(false); }} /> : null}
    </div>
  );
}

function CampaignCreateDialog({ onClose, onCreated }: Readonly<{ onClose: () => void; onCreated: (id: string) => void }>) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("ALL");
  const [targetValue, setTargetValue] = useState("");
  const audienceQuery = useQuery({
    queryKey: ["whatsapp-campaign-audience", targetType, targetValue],
    queryFn: () => {
      const query = new URLSearchParams({ targetType });
      if (targetValue.trim()) {
        query.set("targetValue", targetValue.trim());
      }
      return createAuthenticatedApiClient().get<{ count: number }>(`/whatsapp/campaigns/audience-count?${query.toString()}`);
    },
  });
  const createCampaign = useMutation({
    mutationFn: (sendNow: boolean) => createAuthenticatedApiClient().post<CampaignSummary>("/whatsapp/campaigns", {
      name,
      message,
      targetType,
      targetValue: targetValue.trim() || undefined,
    }).then(async (campaign) => {
      if (sendNow) {
        await createAuthenticatedApiClient().post(`/whatsapp/campaigns/${campaign.id}/send`, {});
      }
      return campaign;
    }),
    onSuccess: async (campaign) => {
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-campaigns"] });
      onCreated(campaign.id);
    },
  });
  const requiresTargetValue = targetType === "TAG" || targetType === "LOYALTY_TIER";
  const canSubmit = name.trim() && message.trim() && (!requiresTargetValue || targetValue.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <section className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <MessageCircle className="size-4 text-emerald-700" aria-hidden="true" />
              New WhatsApp campaign
            </div>
            <p className="mt-1 text-xs text-slate-500">Create the message once and send to the selected audience.</p>
          </div>
          <button type="button" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-slate-100" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-3 p-4">
          {createCampaign.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{createCampaign.error.message}</div> : null}
          <label className="text-sm font-medium text-slate-700">
            Campaign name
            <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" placeholder="May offer reminder" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Message
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 min-h-36 w-full rounded-md border border-border px-3 py-2 text-sm" placeholder="Hello {{customerName}}, ..." />
            <span className="mt-1 block text-xs text-slate-500">{message.length}/4096 characters. WhatsApp supports *bold*, _italic_, and line breaks.</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Audience
              <select value={targetType} onChange={(event) => setTargetType(event.target.value as TargetType)} className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm">
                <option value="ALL">All customers</option>
                <option value="OUTSTANDING">Customers with outstanding</option>
                <option value="LOYALTY_TIER">Loyalty tier</option>
                <option value="TAG">Remark/tag text</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Target value
              <input value={targetValue} onChange={(event) => setTargetValue(event.target.value)} disabled={!requiresTargetValue} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm disabled:bg-slate-50" placeholder={targetType === "LOYALTY_TIER" ? "Gold" : targetType === "TAG" ? "VIP" : "Not required"} />
            </label>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Estimated reach: {audienceQuery.isLoading ? "checking..." : `${String(audienceQuery.data?.count ?? 0)} customers`}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
          <button type="button" className="h-10 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!canSubmit || createCampaign.isPending} className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 disabled:opacity-50" onClick={() => createCampaign.mutate(false)}>Save draft</button>
          <button type="button" disabled={!canSubmit || createCampaign.isPending} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => createCampaign.mutate(true)}>
            <Send className="size-4" aria-hidden="true" />
            Send now
          </button>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
    </div>
  );
}

function campaignStatusClass(status: string): string {
  if (status === "COMPLETED") return "bg-emerald-50 text-emerald-700";
  if (status === "SENDING") return "bg-blue-50 text-blue-700";
  if (status === "CANCELLED") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}
