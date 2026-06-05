/// <reference path="../zustand-shim.d.ts" />

import { create } from "zustand";

import type { PosLine } from "../types/index.js";

export type { PosLine } from "../types/index.js";

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
  addOrIncrementLine: (line: Omit<PosLine, "id">) => void;
  removeLine: (id: string) => void;
  reset: () => void;
  holdBill: (customerId: string, label?: string) => void;
  restoreHeld: (id: string) => void;
  deleteHeld: (id: string) => void;
}

let memoryHeldBills: HeldBill[] = [];

function randomId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  return typeof cryptoApi?.randomUUID === "function"
    ? cryptoApi.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createEmptyLine(): PosLine {
  return {
    id: randomId(),
    productId: "",
    productName: "",
    quantity: 1,
    sellingPrice: 0,
    discount: 0,
    gstRate: 0,
  };
}

function getStorage(): Storage | null {
  return typeof window !== "undefined" && "localStorage" in window ? window.localStorage : null;
}

function loadHeldBills(): HeldBill[] {
  const storage = getStorage();
  if (!storage) return memoryHeldBills;
  try {
    return JSON.parse(storage.getItem("held_bills") ?? "[]") as HeldBill[];
  } catch {
    return [];
  }
}

function saveHeldBills(bills: HeldBill[]): void {
  memoryHeldBills = bills;
  getStorage()?.setItem("held_bills", JSON.stringify(bills));
}

export const useBillingStore = create<BillingState>((set, get) => ({
  lines: [],
  heldBills: loadHeldBills(),
  setLines: (lines) => set({ lines }),
  setLine: (id, patch) =>
    set((state: BillingState) => ({
      lines: state.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    })),
  addLine: () => {
    const line = createEmptyLine();
    set((state: BillingState) => ({
      lines: [...state.lines, line],
    }));
    return line.id;
  },
  addOrIncrementLine: (input) =>
    set((state: BillingState) => {
      const existing = state.lines.find((line) => line.productId === input.productId);
      if (existing) {
        return {
          lines: state.lines.map((line) => line.id === existing.id ? { ...line, quantity: line.quantity + input.quantity } : line),
        };
      }
      return { lines: [...state.lines, { ...input, id: randomId() }] };
    }),
  removeLine: (id) =>
    set((state: BillingState) => ({
      lines: state.lines.filter((line) => line.id !== id),
    })),
  reset: () => set({ lines: [] }),
  holdBill: (customerId, label) => {
    const { lines, heldBills } = get();
    const held: HeldBill = {
      id: randomId(),
      label: label ?? `Bill ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
      lines: lines.filter((line) => line.productId),
      customerId,
      heldAt: new Date().toISOString(),
    };
    const updated = [...heldBills, held];
    saveHeldBills(updated);
    set({ heldBills: updated, lines: [] });
  },
  restoreHeld: (id) => {
    const held = get().heldBills.find((bill) => bill.id === id);
    if (held) {
      set({ lines: held.lines });
    }
  },
  deleteHeld: (id) => {
    const updated = get().heldBills.filter((bill) => bill.id !== id);
    saveHeldBills(updated);
    set({ heldBills: updated });
  },
}));
