import * as XLSX from "xlsx";

export interface ExcelColumn {
  key: string;
  header: string;
  required: boolean;
  sample?: string | number;
}

export type ExcelRow = Record<string, unknown>;

export function parseWorkbookRows(buffer: Buffer): ExcelRow[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rows.filter((row) => Object.values(row).some((value) => String(value).trim().length > 0));
}

export function buildExcelHtml(input: {
  title: string;
  columns: readonly ExcelColumn[];
  rows?: readonly Record<string, unknown>[];
}): string {
  const rows = input.rows && input.rows.length > 0 ? input.rows : [sampleRow(input.columns)];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #94a3b8; padding: 6px 8px; mso-number-format:"\\@"; }
    .title { background: #0f766e; color: #ffffff; font-size: 16px; font-weight: 700; }
    .mandatory { background: #fecaca; color: #7f1d1d; font-weight: 700; }
    .optional { background: #dbeafe; color: #1e3a8a; font-weight: 700; }
    .legend-required { background: #fecaca; color: #7f1d1d; font-weight: 700; }
    .legend-optional { background: #dbeafe; color: #1e3a8a; font-weight: 700; }
  </style>
</head>
<body>
  <table>
    <tr><td class="title" colspan="${String(input.columns.length)}">${escapeHtml(input.title)}</td></tr>
    <tr>
      <td class="legend-required">Mandatory fields</td>
      <td class="legend-optional">Optional fields</td>
      ${input.columns.length > 2 ? `<td colspan="${String(input.columns.length - 2)}">Do not rename column headers.</td>` : ""}
    </tr>
    <tr>
      ${input.columns.map((column) => `<th class="${column.required ? "mandatory" : "optional"}">${escapeHtml(column.header)}</th>`).join("")}
    </tr>
    ${rows.map((row) => `<tr>${input.columns.map((column) => `<td>${escapeHtml(readCell(row, column.header))}</td>`).join("")}</tr>`).join("")}
  </table>
</body>
</html>`;
}

export function sendExcelHtml(reply: { header: (name: string, value: string) => typeof reply; send: (payload: string) => unknown }, filename: string, html: string): unknown {
  return reply
    .header("Content-Type", "application/vnd.ms-excel; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(html);
}

export function getString(row: ExcelRow, headers: readonly string[]): string | undefined {
  for (const header of headers) {
    const value = row[header];
    if (value !== undefined && value !== null) {
      const text = cellToString(value).trim();
      if (text.length > 0) {
        return text;
      }
    }
  }

  return undefined;
}

export function getNumber(row: ExcelRow, headers: readonly string[]): number | undefined {
  const value = getString(row, headers);
  if (!value) {
    return undefined;
  }

  const numeric = Number(value.replaceAll(",", ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function getBoolean(row: ExcelRow, headers: readonly string[]): boolean | undefined {
  const value = getString(row, headers)?.toLowerCase();
  if (!value) {
    return undefined;
  }

  if (["yes", "y", "true", "1", "enabled"].includes(value)) {
    return true;
  }

  if (["no", "n", "false", "0", "disabled"].includes(value)) {
    return false;
  }

  return undefined;
}

export function getDate(row: ExcelRow, headers: readonly string[]): Date | undefined {
  const value = getString(row, headers);
  if (!value) {
    return undefined;
  }

  const parsed = parseIndianDate(value) ?? new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseIndianDate(value: string): Date | undefined {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (!match) {
    return undefined;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return new Date(Date.UTC(year, month - 1, day));
}

function sampleRow(columns: readonly ExcelColumn[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column.header, column.sample ?? ""]));
}

function readCell(row: Record<string, unknown>, header: string): string {
  const value = row[header];
  if (value === undefined || value === null) {
    return "";
  }

  if (value instanceof Date) {
    return value.toLocaleDateString("en-IN");
  }

  return cellToString(value);
}

function cellToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toLocaleDateString("en-IN");
  }

  return "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
