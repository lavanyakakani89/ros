export const DEFAULT_LOCAL_AGENT_URL = "http://127.0.0.1:9211";

export interface LocalAgentPrinter {
  name: string;
  driverName?: string;
  portName?: string;
  status?: string;
  isDefault: boolean;
}

interface LocalAgentPrintRequest {
  agentUrl?: string | null | undefined;
  printerName?: string | null | undefined;
  bytesBase64?: string | undefined;
  jobName?: string;
}

interface LocalAgentPrintResponse {
  status: string;
  message: string;
  jobName?: string;
  bytes?: number;
}

export async function printViaLocalAgent(input: LocalAgentPrintRequest): Promise<LocalAgentPrintResponse> {
  if (!input.bytesBase64) {
    throw new Error("Printer payload was not returned by RetailOS.");
  }

  if (!input.printerName?.trim()) {
    throw new Error("Select the Windows printer name in Settings > Printer setup.");
  }

  const response = await fetch(`${normalizeAgentUrl(input.agentUrl)}/print`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connectionType: "WINDOWS",
      printerName: input.printerName.trim(),
      payloadBase64: input.bytesBase64,
      jobName: input.jobName ?? "RetailOS invoice",
    }),
  });

  if (!response.ok) {
    throw new Error(await localAgentError(response));
  }

  return response.json() as Promise<LocalAgentPrintResponse>;
}

export async function checkLocalAgent(agentUrl?: string | null): Promise<{ status: string; app: string; version: string; platform: string }> {
  const response = await fetch(`${normalizeAgentUrl(agentUrl)}/health`);
  if (!response.ok) {
    throw new Error(await localAgentError(response));
  }

  return response.json() as Promise<{ status: string; app: string; version: string; platform: string }>;
}

export async function listLocalAgentPrinters(agentUrl?: string | null): Promise<LocalAgentPrinter[]> {
  const response = await fetch(`${normalizeAgentUrl(agentUrl)}/printers`);
  if (!response.ok) {
    throw new Error(await localAgentError(response));
  }

  const payload = await response.json() as { printers?: LocalAgentPrinter[] };
  return payload.printers ?? [];
}

export function normalizeAgentUrl(agentUrl?: string | null): string {
  return (agentUrl?.trim() || DEFAULT_LOCAL_AGENT_URL).replace(/\/+$/, "");
}

async function localAgentError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error || `RetailOS Print Agent returned ${String(response.status)}.`;
  } catch {
    return `RetailOS Print Agent returned ${String(response.status)}.`;
  }
}
