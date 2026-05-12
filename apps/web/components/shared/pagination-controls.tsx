"use client";

interface PaginationControlsProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function PaginationControls({ page, limit, total, onPageChange, className }: Readonly<PaginationControlsProps>) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const end = Math.min(safePage * limit, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-slate-500 ${className ?? ""}`}>
      <div>{total === 0 ? "0 records" : `${start.toLocaleString("en-IN")}-${end.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Prev
        </button>
        <span className="min-w-20 text-center">Page {safePage} of {totalPages}</span>
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
