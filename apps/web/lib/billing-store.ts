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

export interface HeldBillCustomer {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  creditLimit?: number | null;
  outstandingDue?: number | null;
}

export interface HeldBillDelivery {
  required: boolean;
  address: string;
  notes: string;
  charge: number;
  scheduledTime: string;
}

export interface HeldBill {
  id: string;
  label: string;
  lines: PosLine[];
  customerId: string;
  customer?: HeldBillCustomer | null;
  delivery?: HeldBillDelivery;
  heldAt: string;
}

export interface HoldBillInput {
  customerId?: string;
  customer?: HeldBillCustomer | null;
  delivery?: HeldBillDelivery;
  label?: string;
}

interface BillingState {
  lines: PosLine[];
  heldBills: HeldBill[];
  autoPrint: boolean;
  setLines: (lines: PosLine[]) => void;
  setLine: (id: string, patch: Partial<PosLine>) => void;
  addLine: () => string;
  removeLine: (id: string) => void;
  reset: () => void;
  holdBill: (input?: HoldBillInput) => void;
  restoreHeld: (id: string) => HeldBill | undefined;
  deleteHeld: (id: string) => void;
  setAutoPrint: (enabled: boolean) => void;
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

function loadAutoPrint(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem("auto_print");
  return stored === null ? true : stored === "true";
}

function saveAutoPrint(enabled: boolean): void {
  localStorage.setItem("auto_print", String(enabled));
}

export const useBillingStore = create<BillingState>((set, get) => ({
  lines: [],
  heldBills: loadHeldBills(),
  autoPrint: loadAutoPrint(),
  setLines: (lines) => set({ lines }),
  setLine: (id, patch) =>
    set((state) => ({
      lines: state.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    })),
  addLine: () => {
    const line = createEmptyLine();
    set((state) => ({
      lines: [line, ...state.lines],
    }));
    return line.id;
  },
  removeLine: (id) =>
    set((state) => ({
      lines: state.lines.filter((line) => line.id !== id),
    })),
  reset: () => set({ lines: [] }),
  holdBill: (input = {}) => {
    const { lines, heldBills } = get();
    const customerName = input.customer ? input.customer.name.trim() : "";
    const held: HeldBill = {
      id: crypto.randomUUID(),
      label: input.label ?? (customerName || `Bill ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`),
      lines: lines.filter((l) => l.productId),
      customerId: input.customerId ?? input.customer?.id ?? "",
      customer: input.customer ?? null,
      ...(input.delivery ? { delivery: input.delivery } : {}),
      heldAt: new Date().toISOString(),
    };
    const updated = [...heldBills, held];
    saveHeldBills(updated);
    set({ heldBills: updated, lines: [] });
  },
  restoreHeld: (id) => {
    const { heldBills } = get();
    const bill = heldBills.find((b) => b.id === id);
    if (!bill) return undefined;
    const updated = heldBills.filter((b) => b.id !== id);
    saveHeldBills(updated);
    set({ heldBills: updated, lines: bill.lines });
    return bill;
  },
  deleteHeld: (id) => {
    const updated = get().heldBills.filter((b) => b.id !== id);
    saveHeldBills(updated);
    set({ heldBills: updated });
  },
  setAutoPrint: (enabled) => {
    saveAutoPrint(enabled);
    set({ autoPrint: enabled });
  },
}));
