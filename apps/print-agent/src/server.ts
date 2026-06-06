import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const host =
  process.env.BIZBIL_PRINT_AGENT_HOST ??
  process.env.RETAILOS_PRINT_AGENT_HOST ??
  "127.0.0.1";
const port = Number(
  process.env.BIZBIL_PRINT_AGENT_PORT ??
    process.env.RETAILOS_PRINT_AGENT_PORT ??
    "9211",
);
const agentKey = (
  process.env.BIZBIL_PRINT_AGENT_KEY ??
  process.env.RETAILOS_PRINT_AGENT_KEY
)?.trim();
const maxPayloadBytes = Number(
  process.env.BIZBIL_PRINT_AGENT_MAX_BYTES ??
    process.env.RETAILOS_PRINT_AGENT_MAX_BYTES ??
    "262144",
);
const defaultTcpPort = 9100;

type PrintConnection = "WINDOWS" | "NETWORK";

interface PrintRequest {
  connectionType?: string;
  printerName?: string;
  host?: string;
  port?: number;
  payloadBase64?: string;
  jobName?: string;
}

interface WindowsPrinter {
  name: string;
  driverName?: string;
  portName?: string;
  status?: string;
  isDefault: boolean;
}

type ValidatedPrintRequest = {
  connectionType: PrintConnection;
  payloadBase64: string;
  jobName: string;
  printerName?: string;
  host?: string;
  port: number;
};

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(port, host, () => {
  console.log(`BizBil Print Agent listening on http://${host}:${String(port)}`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const path = new URL(request.url ?? "/", `http://${host}:${String(port)}`).pathname;

  try {
    if (request.method === "GET" && path === "/health") {
      sendJson(response, 200, {
        status: "ok",
        app: "BizBil Local Print Agent",
        version: "0.1.0",
        platform: process.platform,
      });
      return;
    }

    if (request.method === "GET" && path === "/printers") {
      sendJson(response, 200, {
        printers: await listPrinters(),
      });
      return;
    }

    if (request.method === "POST" && path === "/print") {
      requireAgentKey(request);
      const payload = validatePrintRequest(await readJsonBody<PrintRequest>(request));
      await dispatchPrint(payload);
      sendJson(response, 200, {
        status: "printed",
        message: "Print job sent to local printer.",
        jobName: payload.jobName,
        bytes: Buffer.from(payload.payloadBase64, "base64").length,
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, error instanceof HttpError ? error.statusCode : 500, {
      error: error instanceof Error ? error.message : "Print agent error",
    });
  }
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-BizBil-Agent-Key, X-RetailOS-Agent-Key",
  );
  response.setHeader("Access-Control-Max-Age", "86400");
}

function requireAgentKey(request: IncomingMessage): void {
  if (!agentKey) {
    return;
  }

  const value = request.headers["x-bizbil-agent-key"] ?? request.headers["x-retailos-agent-key"];
  if (typeof value !== "string" || value !== agentKey) {
    throw new HttpError(401, "Invalid print agent key.");
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > maxPayloadBytes * 2) {
        reject(new HttpError(413, "Print request is too large."));
        request.destroy();
        return;
      }
      chunks.push(bytes);
    });

    request.once("error", reject);
    request.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
  });
}

function validatePrintRequest(input: PrintRequest): ValidatedPrintRequest {
  const connectionType = input.connectionType ?? "WINDOWS";
  if (connectionType !== "WINDOWS" && connectionType !== "NETWORK") {
    throw new HttpError(400, "connectionType must be WINDOWS or NETWORK.");
  }

  if (typeof input.payloadBase64 !== "string" || !input.payloadBase64.trim()) {
    throw new HttpError(400, "payloadBase64 is required.");
  }

  const bytes = Buffer.from(input.payloadBase64, "base64");
  if (bytes.length === 0 || bytes.length > maxPayloadBytes) {
    throw new HttpError(400, `ESC/POS payload must be between 1 and ${String(maxPayloadBytes)} bytes.`);
  }

  if (connectionType === "WINDOWS" && !input.printerName?.trim()) {
    throw new HttpError(400, "printerName is required for WINDOWS printing.");
  }

  if (connectionType === "NETWORK" && !input.host?.trim()) {
    throw new HttpError(400, "host is required for NETWORK printing.");
  }

  const result: ValidatedPrintRequest = {
    connectionType,
    payloadBase64: input.payloadBase64,
    jobName: sanitizeJobName(input.jobName ?? "BizBil invoice"),
    port: input.port ?? defaultTcpPort,
  };

  const printerName = input.printerName?.trim();
  if (printerName) {
    result.printerName = printerName;
  }

  const hostName = input.host?.trim();
  if (hostName) {
    result.host = hostName;
  }

  return result;
}

async function dispatchPrint(payload: ValidatedPrintRequest): Promise<void> {
  const bytes = Buffer.from(payload.payloadBase64, "base64");

  if (payload.connectionType === "NETWORK") {
    if (!payload.host) {
      throw new HttpError(400, "host is required for NETWORK printing.");
    }
    await sendTcp(payload.host, payload.port, bytes);
    return;
  }

  if (process.platform !== "win32") {
    throw new HttpError(501, "Windows spooler printing is only available on Windows.");
  }

  await printRawToWindowsPrinter({
    printerName: payload.printerName ?? "",
    jobName: payload.jobName,
    bytes,
  });
}

async function sendTcp(hostName: string, tcpPort: number, bytes: Buffer): Promise<void> {
  if (!Number.isInteger(tcpPort) || tcpPort < 1 || tcpPort > 65535) {
    throw new HttpError(400, "Network printer port must be 1-65535.");
  }

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: hostName, port: tcpPort, timeout: 5000 }, () => {
      socket.write(bytes, (error) => {
        if (error) {
          reject(error);
          return;
        }
        socket.end();
      });
    });

    socket.once("timeout", () => {
      socket.destroy(new Error("Printer connection timed out."));
    });
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      if (!hadError) {
        resolve();
      }
    });
  });
}

async function listPrinters(): Promise<WindowsPrinter[]> {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const output = await runPowerShell([
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Printer | Select-Object Name,DriverName,PortName,Default,PrinterStatus | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(output || "[]") as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map(toWindowsPrinter)
      .filter((printer) => printer.name.length > 0);
  } catch {
    return [];
  }
}

function toWindowsPrinter(item: Record<string, unknown>): WindowsPrinter {
  const printer: WindowsPrinter = {
    name: stringValue(item.Name) ?? "",
    isDefault: Boolean(item.Default),
  };

  const driverName = stringValue(item.DriverName);
  if (driverName) {
    printer.driverName = driverName;
  }

  const portName = stringValue(item.PortName);
  if (portName) {
    printer.portName = portName;
  }

  const status = stringValue(item.PrinterStatus);
  if (status) {
    printer.status = status;
  }

  return printer;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

async function printRawToWindowsPrinter(input: { printerName: string; jobName: string; bytes: Buffer }): Promise<void> {
  const dir = await mkdtemp(join(os.tmpdir(), "bizbil-print-"));
  const dataPath = join(dir, "job.bin");
  const scriptPath = join(dir, "print-raw.ps1");

  try {
    await writeFile(dataPath, input.bytes);
    await writeFile(scriptPath, rawPrinterPowerShell, "utf8");
    await runPowerShell([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-PrinterName",
      input.printerName,
      "-Path",
      dataPath,
      "-JobName",
      input.jobName,
    ]);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

function runPowerShell(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new Error(err || `PowerShell exited with code ${String(code)}`));
    });
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(statusCode === 204 ? "" : JSON.stringify(body));
}

function sanitizeJobName(value: string): string {
  return value.replace(/[^\w .-]/g, "").trim().slice(0, 80) || "BizBil invoice";
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const rawPrinterPowerShell = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$JobName
)

$source = @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
"@

Add-Type -TypeDefinition $source

$bytes = [System.IO.File]::ReadAllBytes($Path)
$handle = [IntPtr]::Zero

if (-not [RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) {
  throw "Cannot open printer '$PrinterName'."
}

try {
  $docInfo = New-Object RawPrinterHelper+DOCINFOA
  $docInfo.pDocName = $JobName
  $docInfo.pDataType = "RAW"

  if (-not [RawPrinterHelper]::StartDocPrinter($handle, 1, $docInfo)) {
    throw "Cannot start raw print document."
  }

  try {
    if (-not [RawPrinterHelper]::StartPagePrinter($handle)) {
      throw "Cannot start raw print page."
    }

    try {
      $pointer = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
      try {
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
        $written = 0
        if (-not [RawPrinterHelper]::WritePrinter($handle, $pointer, $bytes.Length, [ref]$written)) {
          throw "Raw printer write failed."
        }
        if ($written -ne $bytes.Length) {
          throw "Raw printer accepted $written of $($bytes.Length) bytes."
        }
      } finally {
        [Runtime.InteropServices.Marshal]::FreeCoTaskMem($pointer)
      }
    } finally {
      [RawPrinterHelper]::EndPagePrinter($handle) | Out-Null
    }
  } finally {
    [RawPrinterHelper]::EndDocPrinter($handle) | Out-Null
  }
} finally {
  [RawPrinterHelper]::ClosePrinter($handle) | Out-Null
}
`;
