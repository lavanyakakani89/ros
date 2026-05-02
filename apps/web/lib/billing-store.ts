import { create } from "zustand";

export interface PosLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  discount: number;
}

interface BillingState {
  lines: PosLine[];
  setLine: (id: string, patch: Partial<PosLine>) => void;
  addLine: () => void;
  removeLine: (id: string) => void;
  reset: () => void;
}

function createEmptyLine(): PosLine {
  return {
    id: crypto.randomUUID(),
    productId: "",
    productName: "",
    quantity: 1,
    sellingPrice: 0,
    discount: 0,
  };
}

const initialLines: PosLine[] = [
  {
    id: "line-1",
    productId: "",
    productName: "",
    quantity: 1,
    sellingPrice: 0,
    discount: 0,
  },
];

export const useBillingStore = create<BillingState>((set) => ({
  lines: initialLines,
  setLine: (id, patch) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    })),
  addLine: () =>
    set((state) => ({
      lines: [
        ...state.lines,
        createEmptyLine(),
      ],
    })),
  removeLine: (id) =>
    set((state) => ({
      lines: state.lines.filter((line) => line.id !== id),
    })),
  reset: () => set({ lines: [createEmptyLine()] }),
}));
