"use client";

import { cn } from "@/lib/utils";
import type { LabelCanvasField } from "@/lib/types/labels";

const MM_TO_PX = 4;

export interface LabelCanvasRendererProps {
  template: {
    width_mm: number;
    height_mm: number;
  };
  fields: Array<LabelCanvasField & { resolved_content?: string }>;
  scale?: number;
  selectedFieldId?: string | null;
  onSelectField?: (fieldId: string) => void;
  className?: string;
}

export function LabelCanvasRenderer({
  template,
  fields,
  scale = 1,
  selectedFieldId = null,
  onSelectField,
  className,
}: Readonly<LabelCanvasRendererProps>) {
  const widthPx = Math.max(1, Math.round(template.width_mm * MM_TO_PX * scale));
  const heightPx = Math.max(1, Math.round(template.height_mm * MM_TO_PX * scale));

  return (
    <div
      className={cn("relative overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white shadow-sm", className)}
      style={{ width: widthPx, height: heightPx }}
      aria-label={`Label canvas ${String(template.width_mm)} by ${String(template.height_mm)} millimetres`}
    >
      {fields.map((field) => {
        const left = field.x * MM_TO_PX * scale;
        const top = field.y * MM_TO_PX * scale;
        const width = Math.max(1, field.width * MM_TO_PX * scale);
        const height = Math.max(1, field.height * MM_TO_PX * scale);
        const interactive = Boolean(onSelectField);
        const content = field.resolved_content ?? field.textContent ?? labelFieldLabel(field.type);

        const wrapperClass = cn(
          "absolute overflow-hidden rounded-md text-left transition",
          interactive && "cursor-pointer hover:bg-slate-50",
          selectedFieldId === field.id ? "ring-2 ring-emerald-500 ring-offset-1" : "ring-1 ring-transparent",
        );
        const wrapperStyle = {
          left,
          top,
          width,
          height,
          transform: `rotate(${String(field.rotation)}deg)`,
          transformOrigin: "top left",
        } as const;

        if (interactive) {
          return (
            <button
              key={field.id}
              type="button"
              className={wrapperClass}
              style={wrapperStyle}
              onClick={() => onSelectField?.(field.id)}
            >
              {renderFieldContents(field, content)}
            </button>
          );
        }

        return (
          <div key={field.id} className={wrapperClass} style={wrapperStyle}>
            {renderFieldContents(field, content)}
          </div>
        );
      })}
      {fields.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">Add a field to begin designing the label.</div>
      ) : null}
    </div>
  );
}

function renderFieldContents(field: LabelCanvasField & { resolved_content?: string }, content: string) {
  return field.type === "image" || field.type === "qr_code" || field.type === "barcode" ? (
    <div className="flex h-full w-full items-center justify-center bg-white">
      {field.resolved_content || field.imageUrl ? (
        (() => {
          const src = field.resolved_content || field.imageUrl || "";
          return (
            <img
              src={src}
              alt={field.type}
              className="h-full w-full object-contain"
            />
          );
        })()
      ) : (
        <span className="text-[10px] font-medium text-slate-400">{labelFieldLabel(field.type)}</span>
      )}
    </div>
  ) : (
    <div
      className="flex h-full w-full items-center overflow-hidden px-1 py-0.5 text-slate-900"
      style={{
        fontSize: field.fontSize ? field.fontSize * 1.2 : 10,
        fontWeight: field.fontWeight ?? "normal",
        lineHeight: 1.1,
      }}
    >
      <span className="block w-full whitespace-pre-wrap break-words">{content}</span>
    </div>
  );
}

function labelFieldLabel(type: LabelCanvasField["type"]): string {
  switch (type) {
    case "product_name":
      return "Product name";
    case "price":
      return "Price";
    case "quantity":
      return "Quantity";
    case "packed_date":
      return "Packed date";
    case "best_before":
      return "Best before";
    case "qr_code":
      return "QR code";
    case "barcode":
      return "Barcode";
    case "image":
      return "Image";
    case "static_text":
      return "Text";
    default:
      return "Field";
  }
}
