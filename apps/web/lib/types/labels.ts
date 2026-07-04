export const LABEL_LAYOUT_MODES = ["1up", "2up"] as const;
export const LABEL_FIELD_TYPES = [
  "product_name",
  "price",
  "quantity",
  "packed_date",
  "best_before",
  "qr_code",
  "barcode",
  "image",
  "static_text",
] as const;

export type LabelLayoutMode = (typeof LABEL_LAYOUT_MODES)[number];
export type LabelFieldType = (typeof LABEL_FIELD_TYPES)[number];

export interface LabelCanvasField {
  id: string;
  type: LabelFieldType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  textContent?: string;
  imageUrl?: string;
  codeType?: "qr" | "barcode";
  resolved_content?: string;
}

export interface LabelCanvasDefinition {
  fields: LabelCanvasField[];
}

export interface LabelTemplateRecord {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  layout_mode: LabelLayoutMode;
  canvas_json: LabelCanvasDefinition;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: { id: string; name: string; email: string } | null;
}

export interface LabelPreviewField extends LabelCanvasField {
  resolved_content: string;
}

export interface LabelPreviewLabel {
  product_id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  sheet_index: number;
  slot_index: number;
  fields: LabelPreviewField[];
}

export interface LabelPreviewJob {
  templateId: string | null;
  templateName: string;
  width_mm: number;
  height_mm: number;
  layout_mode: LabelLayoutMode;
  sheets: Array<{
    index: number;
    width_mm: number;
    height_mm: number;
    layout_mode: LabelLayoutMode;
    labels: LabelPreviewLabel[];
  }>;
  labels: LabelPreviewLabel[];
  totalLabels: number;
}

export interface LabelPrintJobResponse {
  job: {
    id: string;
    templateId: string | null;
    totalLabels: number;
    outputType: "print" | "pdf";
    printedAt: string;
  };
  printer: {
    connected: boolean;
    name: string | null;
    printer?: {
      id: string;
      connectionType: "USB_PRINTNODE" | "NETWORK" | "BLUETOOTH" | "LOCAL_AGENT" | "NONE";
      paperSize: "THERMAL_2" | "THERMAL_3" | "THERMAL_4" | "A5" | "A4";
      localPrinterName?: string | null;
      labelPrinterName?: string | null;
      localAgentUrl?: string | null;
      networkIp?: string | null;
      networkPort?: number | null;
      printNodePrinterId?: string | null;
      bluetoothDeviceName?: string | null;
      isActive: boolean;
    } | null;
  };
  preview: LabelPreviewJob;
}

export interface LabelTemplateDraft {
  id: string | null;
  name: string;
  width_mm: number;
  height_mm: number;
  layout_mode: LabelLayoutMode;
  canvas_json: LabelCanvasDefinition;
  is_default: boolean;
}
