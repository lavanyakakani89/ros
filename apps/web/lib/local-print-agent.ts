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
  pageImagesBase64?: string[] | undefined;
  paperWidthMm?: number | undefined;
  paperHeightMm?: number | undefined;
  jobName?: string;
}

interface LocalAgentPrintResponse {
  status: string;
  message: string;
  jobName?: string;
  bytes?: number;
}

export async function printViaLocalAgent(input: LocalAgentPrintRequest): Promise<LocalAgentPrintResponse> {
  if (!input.printerName?.trim()) {
    throw new Error("Select the Windows printer name in Settings > Printer setup.");
  }

  const pageImagesBase64 = input.pageImagesBase64?.filter((page) => typeof page === "string" && page.trim().length > 0);
  if (!input.bytesBase64 && (!pageImagesBase64 || pageImagesBase64.length === 0)) {
    throw new Error("Printer payload was not returned by BizBil.");
  }

  const body: Record<string, unknown> = {
    connectionType: "WINDOWS",
    printerName: input.printerName.trim(),
    jobName: input.jobName ?? "BizBil invoice",
  };

  if (input.bytesBase64) {
    body.payloadBase64 = input.bytesBase64;
  }

  if (pageImagesBase64 && pageImagesBase64.length > 0) {
    body.pageImagesBase64 = pageImagesBase64;
  }

  if (typeof input.paperWidthMm === "number" && Number.isFinite(input.paperWidthMm) && input.paperWidthMm > 0) {
    body.paperWidthMm = input.paperWidthMm;
  }

  if (typeof input.paperHeightMm === "number" && Number.isFinite(input.paperHeightMm) && input.paperHeightMm > 0) {
    body.paperHeightMm = input.paperHeightMm;
  }

  const response = await fetch(`${normalizeAgentUrl(input.agentUrl)}/print`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
    return payload.error || `BizBil Print Agent returned ${String(response.status)}.`;
  } catch {
    return `BizBil Print Agent returned ${String(response.status)}.`;
  }
}
