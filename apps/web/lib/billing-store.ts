import { create } from "zustand";

export interface PosLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  discount: number;
  gstRate: number;
}

export interface HeldBill {
  id: string;
  label: string;
  lines: PosLine[];
  customerId: string;
  heldAt: string;
}

interface BillingState {
  lines: PosLine[];
  heldBills: HeldBill[];
  setLines: (lines: PosLine[]) => void;
  setLine: (id: string, patch: Partial<PosLine>) => void;
  addLine: () => string;
  removeLine: (id: string) => void;
  reset: () => void;
  holdBill: (customerId: string, label?: string) => void;
  restoreHeld: (id: string) => void;
  deleteHeld: (id: string) => void;
}

function createEmptyLine(): PosLine {
  return {
    id: crypto.randomUUID(),
    productId: "",
    productName: "",
    quantity: 1,
    sellingPrice: 0,
    discount: 0,
    gstRate: 0,
  };
}

function loadHeldBills(): HeldBill[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("held_bills") ?? "[]") as HeldBill[];
  } catch {
    return [];
  }
}

function saveHeldBills(bills: HeldBill[]): void {
  localStorage.setItem("held_bills", JSON.stringify(bills));
}

export const useBillingStore = create<BillingState>((set, get) => ({
  lines: [],
  heldBills: loadHeldBills(),
  setLines: (lines) => set({ lines }),
  setLine: (id, patch) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    })),
  addLine: () => {
    const line = createEmptyLine();
    set((state) => ({
      lines: [...state.lines, line],
    }));
    return line.id;
  },
  removeLine: (id) =>
    set((state) => ({
      lines: state.lines.filter((line) => line.id !== id),
    })),
  reset: () => set({ lines: [] }),
  holdBill: (customerId, label) => {
    const { lines, heldBills } = get();
    const held: HeldBill = {
      id: crypto.randomUUID(),
      label: label ?? `Bill ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
      lines: lines.filter((l) => l.productId),
      customerId,
      heldAt: new Date().toISOString(),
    };
    const updated = [...heldBills, held];
    saveHeldBills(updated);
    set({ heldBills: updated, lines: [] });
  },
  restoreHeld: (id) => {
    const { heldBills } = get();
    const bill = heldBills.find((b) => b.id === id);
    if (!bill) return;
    const updated = heldBills.filter((b) => b.id !== id);
    saveHeldBills(updated);
    set({ heldBills: updated, lines: bill.lines });
  },
  deleteHeld: (id) => {
    const updated = get().heldBills.filter((b) => b.id !== id);
    saveHeldBills(updated);
    set({ heldBills: updated });
  },
}));
