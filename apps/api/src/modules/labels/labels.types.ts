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
export type LabelCodeType = "qr" | "barcode";

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
  codeType?: LabelCodeType;
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
  created_by?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface LabelProductSelection {
  product_id: string;
  quantity: number;
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

export interface ResolvedLabelProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sellingPrice: { toNumber(): number } | string | number;
  mrp: { toNumber(): number } | string | number;
  currentStock: { toNumber(): number } | string | number;
  verticalData: Record<string, unknown> | null;
  batches: Array<{
    expiryDate: Date | null;
    receivedAt: Date;
  }>;
}
