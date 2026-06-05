"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle, Save, Send, Unplug } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { fetchWhatsappMessageTemplates, type WhatsappMessageTemplate, type WhatsappMessageTemplatesResponse } from "@/lib/whatsapp";

interface WhatsappIntegrationResponse {
  status: "NOT_CONNECTED" | "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
  provider: string;
  fallbackConfigured: boolean;
  isConnected: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  businessId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  updatedAt: string | null;
}

interface WhatsappNotificationSettings {
  invoiceConfirmed: boolean;
  deliveryAssigned: boolean;
  deliveryStatusUpdate: boolean;
  expiryAlert: boolean;
  paymentLink: boolean;
  quotationShared: boolean;
  creditNoteShared: boolean;
  birthdayGreeting: boolean;
  anniversaryGreeting: boolean;
}

type WhatsappNotificationKey = keyof WhatsappNotificationSettings;

const notificationEvents: Array<{ key: WhatsappNotificationKey; label: string; description: string }> = [
  { key: "invoiceConfirmed", label: "Invoice confirmed -> customer", description: "Sends invoice/order confirmation after an invoice is confirmed." },
  { key: "deliveryAssigned", label: "Delivery assigned -> agent", description: "Notifies the delivery person when a delivery is assigned." },
  { key: "deliveryStatusUpdate", label: "Delivery status update -> customer", description: "Sends out-for-delivery and delivered updates." },
  { key: "expiryAlert", label: "Expiry alerts -> owner", description: "Daily expiry alerts for relevant shop types." },
  { key: "paymentLink", label: "Payment link sent -> customer", description: "Sends Razorpay payment links for pending dues." },
  { key: "quotationShared", label: "Quotation shared -> customer", description: "Sends quotation PDF links to customers." },
  { key: "creditNoteShared", label: "Credit note shared -> customer", description: "Sends credit note PDF links to customers." },
  { key: "birthdayGreeting", label: "Birthday greeting -> customer", description: "Reserved for the birthday reminder job." },
  { key: "anniversaryGreeting", label: "Anniversary greeting -> customer", description: "Reserved for the anniversary reminder job." },
];

interface EmbeddedSignupConfigResponse {
  isConfigured: boolean;
  appId: string | null;
  configurationId: string | null;
  apiVersion: string;
  callbackUrl: string;
  legacyCallbackUrl: string;
  verifyTokenConfigured: boolean;
  missing: string[];
}

interface FacebookAuthResponse {
  authResponse?: {
    code?: string;
  };
  status?: string;
}

interface FacebookSdk {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(callback: (response: FacebookAuthResponse) => void, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export function WhatsappSettings() {
  const queryClient = useQueryClient();
  const signupSessionRef = useRef<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration"],
    queryFn: () => createAuthenticatedApiClient().get<WhatsappIntegrationResponse>("/whatsapp/integration"),
  });
  const configQuery = useQuery({
    queryKey: ["whatsapp-embedded-config"],
    queryFn: () => createAuthenticatedApiClient().get<EmbeddedSignupConfigResponse>("/whatsapp/embedded-signup/config"),
  });
  const templatesQuery = useQuery({
    queryKey: ["whatsapp-message-templates"],
    queryFn: fetchWhatsappMessageTemplates,
  });
  const notificationsQuery = useQuery({
    queryKey: ["whatsapp-notification-settings"],
    queryFn: () => createAuthenticatedApiClient().get<WhatsappNotificationSettings>("/settings/whatsapp-notifications"),
  });
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});
  const completeSignup = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().post<WhatsappIntegrationResponse & { warnings?: string[] }>("/whatsapp/embedded-signup/complete", payload),
    onSuccess: async (result) => {
      setMessage(result.warnings?.length ? "WhatsApp connected. Review the warning below." : "WhatsApp Business connected.");
      setConnectError(result.warnings?.join("\n") ?? null);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-integration"] });
    },
  });
  const disconnect = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<WhatsappIntegrationResponse>("/whatsapp/integration/disconnect", {}),
    onSuccess: async () => {
      setMessage("WhatsApp disconnected in BizBil.");
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-integration"] });
    },
  });
  const sendTest = useMutation({
    mutationFn: (payload: { phone: string }) => createAuthenticatedApiClient().post("/whatsapp/integration/test", payload),
    onSuccess: () => setMessage("Test message queued."),
  });
  const saveTemplates = useMutation({
    mutationFn: (payload: { templates: Array<{ key: string; body: string }> }) =>
      createAuthenticatedApiClient().put<WhatsappMessageTemplatesResponse>("/whatsapp/message-templates", payload),
    onSuccess: async (result) => {
      setMessage("WhatsApp message templates saved.");
      queryClient.setQueryData(["whatsapp-message-templates"], result);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-message-templates"] });
    },
  });
  const saveNotifications = useMutation({
    mutationFn: (payload: Partial<WhatsappNotificationSettings>) =>
      createAuthenticatedApiClient().put<WhatsappNotificationSettings>("/settings/whatsapp-notifications", payload),
    onSuccess: async (result) => {
      setMessage("WhatsApp notification settings saved.");
      queryClient.setQueryData(["whatsapp-notification-settings"], result);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-notification-settings"] });
    },
  });

  useEffect(() => {
    if (!templatesQuery.data) {
      return;
    }

    setTemplateDrafts(Object.fromEntries(templatesQuery.data.templates.map((template) => [template.key, template.body])));
  }, [templatesQuery.data]);

  const integration = integrationQuery.data;
  const config = configQuery.data;
  const notificationSettings = notificationsQuery.data;
  const error = integrationQuery.error ?? configQuery.error ?? templatesQuery.error ?? notificationsQuery.error ?? completeSignup.error ?? disconnect.error ?? sendTest.error ?? saveTemplates.error ?? saveNotifications.error;

  async function handleConnect() {
    if (!config?.isConfigured || !config.appId || !config.configurationId) {
      setConnectError("WhatsApp Embedded Signup is not configured on the server.");
      return;
    }

    setMessage(null);
    setConnectError(null);
    setIsLaunching(true);
    signupSessionRef.current = null;

    try {
      await loadFacebookSdk(config.appId, config.apiVersion);
      const signupResponse = await launchEmbeddedSignup(config.configurationId);
      const code = signupResponse.authResponse?.code;
      if (!code) {
        setConnectError("WhatsApp signup was cancelled before BizBil received permission.");
        return;
      }

      await wait(400);
      const session = toRecord(signupSessionRef.current);
      const data = toRecord(session.data);
      completeSignup.mutate({
        code,
        phoneNumberId: stringValue(data.phone_number_id),
        wabaId: stringValue(data.waba_id),
        businessId: stringValue(data.business_id),
        sessionPayload: signupSessionRef.current,
      });
    } catch (nextError) {
      setConnectError(nextError instanceof Error ? nextError.message : "Unable to launch WhatsApp signup.");
    } finally {
      setIsLaunching(false);
    }
  }

  function launchEmbeddedSignup(configurationId: string): Promise<FacebookAuthResponse> {
    return new Promise((resolve, reject) => {
      const listener = (event: MessageEvent) => {
        if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") {
          return;
        }

        const data = parseFacebookMessage(event.data);
        if (toRecord(data).type === "WA_EMBEDDED_SIGNUP") {
          signupSessionRef.current = data;
        }
      };

      window.addEventListener("message", listener);
      if (!window.FB) {
        window.removeEventListener("message", listener);
        reject(new Error("Facebook SDK is not ready."));
        return;
      }

      window.FB.login(
        (response) => {
          window.setTimeout(() => window.removeEventListener("message", listener), 2_000);
          resolve(response);
        },
        {
          config_id: configurationId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            sessionInfoVersion: "3",
          },
        },
      );
    });
  }

  function handleTestSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!testPhone.trim()) {
      return;
    }

    setMessage(null);
    sendTest.mutate({ phone: testPhone.trim() });
  }

  function handleTemplatesSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const templates = (templatesQuery.data?.templates ?? []).map((template) => ({
      key: template.key,
      body: templateDrafts[template.key] ?? template.body,
    }));
    saveTemplates.mutate({ templates });
  }

  function resetTemplate(template: WhatsappMessageTemplate) {
    setTemplateDrafts((current) => ({
      ...current,
      [template.key]: template.defaultBody,
    }));
  }

  function handleNotificationToggle(key: WhatsappNotificationKey, enabled: boolean) {
    const payload: Partial<WhatsappNotificationSettings> = {};
    payload[key] = enabled;
    setMessage(null);
    saveNotifications.mutate(payload);
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {connectError ? <Alert tone="error">{connectError}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}

      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
              <MessageCircle className="size-4 text-emerald-700" aria-hidden="true" />
              Manual WhatsApp
            </div>
            <div className="mt-1 text-xs text-emerald-700">Default mode for invoice sharing, delivery updates, and pasted orders.</div>
          </div>
          <span className="inline-flex h-8 items-center rounded-md bg-white px-3 text-xs font-semibold text-emerald-700">Active</span>
        </div>
      </section>

      <section className="rounded-md border border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <MessageCircle className="size-4 text-emerald-700" aria-hidden="true" />
              Automated WhatsApp
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {statusLine(integration)}
            </div>
          </div>
          <StatusBadge status={integration?.status ?? "NOT_CONNECTED"} />
        </div>

        <dl className="mt-4 grid gap-3 md:grid-cols-3">
          <InfoItem label="Shop number" value={integration?.displayPhoneNumber ?? "Not connected"} />
          <InfoItem label="Verified name" value={integration?.verifiedName ?? "-"} />
          <InfoItem label="Phone number ID" value={integration?.phoneNumberId ?? "-"} />
        </dl>

        {integration?.lastError ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{integration.lastError}</div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={isLaunching || completeSignup.isPending || configQuery.isLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLaunching || completeSignup.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <MessageCircle className="size-4" aria-hidden="true" />}
            {integration?.isConnected ? "Reconnect WhatsApp" : "Connect WhatsApp"}
          </button>
          <button
            type="button"
            onClick={() => disconnect.mutate()}
            disabled={!integration || integration.status === "NOT_CONNECTED" || disconnect.isPending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 px-4 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Unplug className="size-4" aria-hidden="true" />
            Disconnect
          </button>
        </div>

        {!config?.isConfigured ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Missing server config: {(config?.missing ?? []).join(", ") || "loading"}.
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-border bg-white p-4">
        <div>
          <div className="text-sm font-semibold text-slate-950">Notification events</div>
          <div className="mt-1 text-xs text-slate-500">Turn automatic WhatsApp sends on or off by event. Manual wa.me buttons still work.</div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {notificationEvents.map((event) => (
            <label key={event.key} className="flex min-h-16 items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
              <span>
                <span className="block text-sm font-semibold text-slate-950">{event.label}</span>
                <span className="mt-1 block text-xs text-slate-500">{event.description}</span>
              </span>
              <input
                type="checkbox"
                checked={notificationSettings?.[event.key] ?? true}
                disabled={notificationsQuery.isLoading || saveNotifications.isPending}
                onChange={(changeEvent) => handleNotificationToggle(event.key, changeEvent.target.checked)}
                className="size-5 accent-emerald-600"
              />
            </label>
          ))}
        </div>
        {notificationsQuery.isLoading ? <div className="mt-3 text-sm text-slate-500">Loading notification settings...</div> : null}
      </section>

      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Test message</div>
        <form className="flex flex-col gap-2 md:flex-row" onSubmit={handleTestSubmit}>
          <input
            value={testPhone}
            onChange={(event) => setTestPhone(event.target.value)}
            placeholder="Customer mobile number"
            className="h-10 flex-1 rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600"
          />
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={sendTest.isPending || !testPhone.trim()}
          >
            {sendTest.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            Send test
          </button>
        </form>
      </section>

      <section className="rounded-md border border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950">Message templates</div>
            <div className="mt-1 text-xs text-slate-500">Used by invoices, payment reminders, delivery updates, and automated WhatsApp messages.</div>
          </div>
          <button
            type="submit"
            form="whatsapp-message-template-form"
            disabled={saveTemplates.isPending || templatesQuery.isLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveTemplates.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            Save templates
          </button>
        </div>
        <form id="whatsapp-message-template-form" className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={handleTemplatesSubmit}>
          {(templatesQuery.data?.templates ?? []).map((template) => (
            <div key={template.key} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <label className="text-sm font-semibold text-slate-950" htmlFor={`whatsapp-template-${template.key}`}>{template.label}</label>
                  <div className="mt-1 text-xs text-slate-500">{template.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => resetTemplate(template)}
                  className="h-8 rounded-md border border-border px-2 text-xs font-medium text-slate-600"
                >
                  Reset
                </button>
              </div>
              <textarea
                id={`whatsapp-template-${template.key}`}
                value={templateDrafts[template.key] ?? template.body}
                onChange={(event) => setTemplateDrafts((current) => ({ ...current, [template.key]: event.target.value }))}
                className="mt-3 min-h-32 w-full rounded-md border border-border px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
              <div className="mt-2 text-xs text-slate-500">
                Placeholders: {template.placeholders.map((placeholder) => `{{${placeholder}}}`).join(", ")}
              </div>
            </div>
          ))}
          {templatesQuery.isLoading ? <div className="text-sm text-slate-500">Loading message templates...</div> : null}
        </form>
      </section>

      <section className="rounded-md border border-border bg-white p-4">
        <div className="mb-3 text-sm font-semibold text-slate-950">Webhook URLs</div>
        <div className="space-y-2 text-xs text-slate-600">
          <CopyLine label="Embedded Signup webhook" value={config?.callbackUrl ?? "-"} />
          <CopyLine label="Legacy slug webhook" value={config?.legacyCallbackUrl ?? "-"} />
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: WhatsappIntegrationResponse["status"] }>) {
  const connected = status === "CONNECTED";
  const problem = status === "ERROR";

  return (
    <span className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold ${
      connected ? "bg-emerald-50 text-emerald-700" : problem ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"
    }`}>
      {connected ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
      {status.replaceAll("_", " ")}
    </span>
  );
}

function InfoItem({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function CopyLine({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="font-medium text-slate-800">{label}</div>
      <code className="mt-1 block overflow-x-auto whitespace-nowrap text-slate-600">{value}</code>
    </div>
  );
}

function Alert({ tone, children }: Readonly<{ tone: "error" | "success"; children: ReactNode }>) {
  const classes = tone === "error"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return <div className={`rounded-md border p-3 text-sm ${classes}`}>{children}</div>;
}

function statusLine(integration: WhatsappIntegrationResponse | undefined): string {
  if (!integration) {
    return "Loading connection status.";
  }

  if (integration.isConnected) {
    return "Orders, invoice links, and delivery updates use this shop number.";
  }

  if (integration.fallbackConfigured) {
    return "Global server WhatsApp credentials are still available as fallback.";
  }

  return "Optional upgrade for automatic incoming orders and status messages.";
}

async function loadFacebookSdk(appId: string, apiVersion: string): Promise<void> {
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: true, version: apiVersion });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: true, version: apiVersion });
      resolve();
    };

    const existingScript = document.getElementById("facebook-jssdk");
    if (existingScript) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Unable to load Facebook SDK."));
    document.body.append(script);
  });
}

function parseFacebookMessage(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
