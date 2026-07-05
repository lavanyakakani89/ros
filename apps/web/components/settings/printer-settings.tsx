"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bluetooth, Network, Printer, RefreshCcw, Save, Usb } from "lucide-react";
import { useEffect, useState } from "react";

import { createAuthenticatedApiClient } from "@/lib/api-client";
import { DEFAULT_LOCAL_AGENT_URL, checkLocalAgent, listLocalAgentPrinters, printViaLocalAgent, type LocalAgentPrinter } from "@/lib/local-print-agent";

type PaperSize = "THERMAL_2" | "THERMAL_3" | "THERMAL_4" | "A5" | "A4";
type PrinterConn = "USB_PRINTNODE" | "NETWORK" | "BLUETOOTH" | "LOCAL_AGENT" | "NONE";

interface PrinterConfig {
  id: string;
  connectionType: PrinterConn;
  paperSize: PaperSize;
  networkIp?: string | null;
  networkPort?: number | null;
  printNodeApiKey?: string | null;
  printNodePrinterId?: string | null;
  bluetoothDeviceId?: string | null;
  bluetoothDeviceName?: string | null;
  localPrinterName?: string | null;
  labelPrinterName?: string | null;
  localAgentUrl?: string | null;
  isActive: boolean;
  lastTestedAt?: string | null;
}

interface PrinterResponse {
  printer?: PrinterConfig | null;
}

interface TestResponse {
  status: string;
  message: string;
  bytesBase64?: string;
  printerName?: string | null;
  agentUrl?: string | null;
  previewText?: string;
}

const paperSizes: PaperSize[] = ["THERMAL_2", "THERMAL_3", "THERMAL_4", "A5", "A4"];
const connectionTypes: Array<{ value: PrinterConn; label: string; icon: React.ElementType }> = [
  { value: "NONE", label: "PDF only", icon: Printer },
  { value: "LOCAL_AGENT", label: "BizBil Local Agent", icon: Printer },
  { value: "NETWORK", label: "Network ESC/POS", icon: Network },
  { value: "USB_PRINTNODE", label: "USB via PrintNode", icon: Usb },
  { value: "BLUETOOTH", label: "Bluetooth payload", icon: Bluetooth },
];

export function PrinterSettings() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [agentUrl, setAgentUrl] = useState(DEFAULT_LOCAL_AGENT_URL);
  const [agentPrinters, setAgentPrinters] = useState<LocalAgentPrinter[]>([]);
  const printerQuery = useQuery({
    queryKey: ["printer-config"],
    queryFn: () => createAuthenticatedApiClient().get<PrinterResponse>("/printer"),
  });
  const savePrinter = useMutation({
    mutationFn: (payload: object) => createAuthenticatedApiClient().put("/printer", payload),
    onSuccess: async () => {
      setMessage("Printer settings saved.");
      await queryClient.invalidateQueries({ queryKey: ["printer-config"] });
    },
  });
  const testSavedPrinter = useMutation({
    mutationFn: () => createAuthenticatedApiClient().post<TestResponse>("/printer/test", {}),
    onSuccess: (result) => {
      void handleTestPrinterResult(result);
    },
  });
  const testSelectedPrinter = useMutation({
    mutationFn: async ({ printerName, kind }: { printerName: string; kind: "receipt" | "label" }) => {
      if (!printerName.trim()) {
        throw new Error("Choose a Windows printer first.");
      }

      const bytesBase64 = buildEscposTestBase64([
        "BizBil printer test",
        kind === "receipt" ? `Receipt printer: ${printerName}` : `Label printer: ${printerName}`,
        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        "If this prints, billing print is ready.",
      ]);

      return printViaLocalAgent({
        agentUrl,
        printerName,
        bytesBase64,
        jobName: kind === "receipt" ? "BizBil receipt printer test" : "BizBil label printer test",
      });
    },
    onSuccess: (_result, variables) => {
      setMessage(`${variables.kind === "receipt" ? "Receipt" : "Label"} printer test sent to ${variables.printerName}.`);
    },
  });
  const checkAgent = useMutation({
    mutationFn: () => checkLocalAgent(agentUrl),
    onSuccess: (result) => {
      setMessage(`${result.app} is running on ${result.platform}.`);
    },
  });
  const loadAgentPrinters = useMutation({
    mutationFn: () => listLocalAgentPrinters(agentUrl),
    onSuccess: (printers) => {
      setAgentPrinters(printers);
      setMessage(printers.length > 0 ? `${printers.length.toString()} Windows printers found.` : "Print agent is running, but no Windows printers were returned.");
    },
  });

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    savePrinter.mutate({
      connectionType: formString(form, "connectionType"),
      paperSize: formString(form, "paperSize"),
      networkIp: formString(form, "networkIp") || null,
      networkPort: formString(form, "networkPort") ? Number(formString(form, "networkPort")) : null,
      printNodeApiKey: formString(form, "printNodeApiKey") || null,
      printNodePrinterId: formString(form, "printNodePrinterId") || null,
      bluetoothDeviceId: formString(form, "bluetoothDeviceId") || null,
      bluetoothDeviceName: formString(form, "bluetoothDeviceName") || null,
      localPrinterName: formString(form, "localPrinterName") || null,
      labelPrinterName: formString(form, "labelPrinterName") || null,
      localAgentUrl: formString(form, "localAgentUrl") || DEFAULT_LOCAL_AGENT_URL,
      isActive: form.get("isActive") === "on",
    });
  }

  const printer = printerQuery.data?.printer;
  const error = printerQuery.error ?? savePrinter.error ?? testSavedPrinter.error ?? checkAgent.error ?? loadAgentPrinters.error ?? testSelectedPrinter.error;

  useEffect(() => {
    if (printer?.localAgentUrl) {
      setAgentUrl(printer.localAgentUrl);
    }
  }, [printer?.localAgentUrl]);

  async function handleTestPrinterResult(result: TestResponse) {
    setTestResult(result);

    if (result.status !== "local_agent_payload") {
      setMessage(result.message);
      return;
    }

    try {
      await printViaLocalAgent({
        agentUrl: result.agentUrl ?? agentUrl,
        printerName: result.printerName,
        bytesBase64: result.bytesBase64,
        jobName: "BizBil test print",
      });
      setMessage("Test print sent through BizBil Local Print Agent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Local print agent test failed.");
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <form className="rounded-md border border-border bg-white p-4" onSubmit={handleSubmit}>
        <div className="mb-4">
          <div className="text-sm font-semibold text-slate-950">Connection</div>
          <div className="text-xs text-slate-500">Thermal printers use ESC/POS bytes. A4/A5 templates stay as PDF fallback.</div>
        </div>
        {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error.message}</div> : null}
        {message ? <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Connection type
            <select name="connectionType" defaultValue={printer?.connectionType ?? "NONE"} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              {connectionTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Paper size
            <select name="paperSize" defaultValue={printer?.paperSize ?? "THERMAL_3"} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm">
              {paperSizes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <TextInput name="networkIp" label="Network IP" defaultValue={printer?.networkIp ?? ""} />
          <TextInput name="networkPort" label="Network port" type="number" defaultValue={printer?.networkPort?.toString() ?? "9100"} />
          <TextInput name="printNodeApiKey" label="PrintNode API key" type="password" defaultValue={printer?.printNodeApiKey ?? ""} />
          <TextInput name="printNodePrinterId" label="PrintNode printer ID" defaultValue={printer?.printNodePrinterId ?? ""} />
          <TextInput name="bluetoothDeviceId" label="Bluetooth device ID" defaultValue={printer?.bluetoothDeviceId ?? ""} />
          <TextInput name="bluetoothDeviceName" label="Bluetooth device name" defaultValue={printer?.bluetoothDeviceName ?? ""} />
          <PrinterPicker
            name="localPrinterName"
            label="Receipt printer"
            defaultValue={printer?.localPrinterName ?? ""}
            printers={agentPrinters}
            placeholder="Select a Receipt printer"
            testButtonLabel="Test receipt printer"
            onTest={(printerName) => testSelectedPrinter.mutate({ printerName, kind: "receipt" })}
            testPending={testSelectedPrinter.isPending}
          />
          <PrinterPicker
            name="labelPrinterName"
            label="Label printer"
            defaultValue={printer?.labelPrinterName ?? ""}
            printers={agentPrinters}
            placeholder="Select a label printer"
            testButtonLabel="Test label printer"
            onTest={(printerName) => testSelectedPrinter.mutate({ printerName, kind: "label" })}
            testPending={testSelectedPrinter.isPending}
          />
          <label className="block text-sm font-medium text-slate-700">
            Local agent URL
            <input
              name="localAgentUrl"
              value={agentUrl}
              onChange={(event) => setAgentUrl(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600"
            />
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="isActive" type="checkbox" defaultChecked={printer?.isActive ?? true} className="size-4 rounded border-border" />
          Active printer
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white" disabled={savePrinter.isPending}>
            <Save className="size-4" aria-hidden="true" />
            Save printer
          </button>
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={() => testSavedPrinter.mutate()} disabled={testSavedPrinter.isPending}>
            <Printer className="size-4" aria-hidden="true" />
            Test saved config
          </button>
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={() => checkAgent.mutate()} disabled={checkAgent.isPending}>
            <RefreshCcw className="size-4" aria-hidden="true" />
            Check agent
          </button>
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={() => loadAgentPrinters.mutate()} disabled={loadAgentPrinters.isPending}>
            <Printer className="size-4" aria-hidden="true" />
            Load Windows printers
          </button>
        </div>
      </form>

      <aside className="rounded-md border border-border bg-white p-4">
        <div className="mb-4 text-sm font-semibold text-slate-950">Printer modes</div>
        <div className="grid gap-3">
          {connectionTypes.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.value} className="flex gap-3 rounded-md border border-slate-200 p-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-950">{item.label}</div>
                  <div className="text-xs text-slate-500">{modeHelp(item.value)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Labels can use the same local agent, but select a separate Windows queue here if you want receipts and labels to go to different printers.
        </div>
        {testResult?.previewText ? (
          <pre className="mt-4 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">{testResult.previewText}</pre>
        ) : null}
      </aside>
    </section>
  );
}

function TextInput({ name, label, defaultValue, type = "text" }: Readonly<{ name: string; label: string; defaultValue: string; type?: string }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600" />
    </label>
  );
}

function PrinterPicker({
  name,
  label,
  defaultValue,
  printers,
  placeholder,
  testButtonLabel,
  onTest,
  testPending,
}: Readonly<{
  name: string;
  label: string;
  defaultValue: string;
  printers: LocalAgentPrinter[];
  placeholder: string;
  testButtonLabel?: string;
  onTest?: (printerName: string) => void;
  testPending?: boolean;
}>) {
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const optionValues = printers.map((item) => item.name);
  const normalizedValue = selectedValue.trim();
  const showSelect = printers.length > 0;
  const savedValueMissing = normalizedValue.length > 0 && !optionValues.includes(normalizedValue);
  const selectOptions = savedValueMissing
    ? [{ name: normalizedValue, isDefault: false, label: `${normalizedValue} (saved)` }, ...printers]
    : printers;

  useEffect(() => {
    setSelectedValue(defaultValue);
  }, [defaultValue]);

  const canTest = Boolean(onTest && normalizedValue);

  return (
    <div className="block text-sm font-medium text-slate-700">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={name}>{label}</label>
        {onTest ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => onTest(normalizedValue)}
            disabled={!canTest || testPending}
          >
            <Printer className="size-3.5" aria-hidden="true" />
            {testButtonLabel ?? "Test printer"}
          </button>
        ) : null}
      </div>
      {showSelect ? (
        <select
          id={name}
          name={name}
          value={selectedValue}
          onChange={(event) => setSelectedValue(event.target.value)}
          className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600"
        >
          <option value="">{placeholder}</option>
          {selectOptions.map((item) => (
            <option key={item.name} value={item.name}>
              {printerOptionLabel(item)}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            id={name}
            name={name}
            value={selectedValue}
            onChange={(event) => setSelectedValue(event.target.value)}
            placeholder="Load Windows printers to choose from the list"
            className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-emerald-600"
          />
          <div className="mt-1 text-xs font-normal text-slate-500">
            {placeholder}
          </div>
        </>
      )}
    </div>
  );
}

function buildEscposTestBase64(lines: string[]): string {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [new Uint8Array([0x1b, 0x40])];

  for (const line of lines) {
    chunks.push(encoder.encode(line));
    chunks.push(encoder.encode("\n"));
  }

  chunks.push(new Uint8Array([0x1b, 0x64, 0x04]));
  chunks.push(new Uint8Array([0x1d, 0x56, 0x00]));

  return bytesToBase64(concatUint8Arrays(chunks));
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function modeHelp(value: PrinterConn): string {
  if (value === "LOCAL_AGENT") return "Best for ATPOS USB printers on the billing PC. Sends ESC/POS bytes to localhost and cuts paper.";
  if (value === "NETWORK") return "Use IP printers on port 9100.";
  if (value === "USB_PRINTNODE") return "Use PrintNode for USB printers attached to a PC.";
  if (value === "BLUETOOTH") return "Returns base64 ESC/POS bytes for browser Bluetooth handoff.";
  return "Use PDF print/download only.";
}

function printerOptionLabel(item: LocalAgentPrinter & { label?: string }): string {
  if ("label" in item && item.label) {
    return item.label;
  }

  return item.isDefault ? `${item.name} (default)` : item.name;
}
