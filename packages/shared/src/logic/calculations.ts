export interface LineTotal {
  taxable: number;
  cgst: number;
  sgst: number;
  total: number;
  discountAmount: number;
}

export interface BillTotals {
  subtotal: number;
  totalLineDiscount: number;
  billDiscount: number;
  totalCgst: number;
  totalSgst: number;
  grandTotal: number;
}

export function calculateLineTotal(
  qty: number,
  sellingPrice: number,
  discountPct: number,
  gstRate: number,
  gstEnabled: boolean,
): LineTotal {
  const gross = qty * sellingPrice;
  const discountAmount = gross * (discountPct / 100);
  const taxable = gross - discountAmount;
  const cgst = gstEnabled ? taxable * gstRate / 200 : 0;
  const sgst = gstEnabled ? taxable * gstRate / 200 : 0;
  const total = taxable + cgst + sgst;
  return { taxable, cgst, sgst, total, discountAmount };
}

export function calculateBillTotals(
  lines: Array<{ qty: number; sellingPrice: number; discountPct: number; gstRate: number }>,
  billDiscount: number,
  gstEnabled: boolean,
): BillTotals {
  const lineTotals = lines.map((line) => calculateLineTotal(line.qty, line.sellingPrice, line.discountPct, line.gstRate, false));
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.sellingPrice, 0);
  const totalLineDiscount = lineTotals.reduce((sum, line) => sum + line.discountAmount, 0);
  const taxableBeforeBillDiscount = lineTotals.reduce((sum, line) => sum + line.taxable, 0);
  const safeBillDiscount = Math.min(Math.max(billDiscount, 0), taxableBeforeBillDiscount);
  const discountRatio = taxableBeforeBillDiscount > 0 ? safeBillDiscount / taxableBeforeBillDiscount : 0;

  const taxTotals = lines.reduce(
    (totals, line, index) => {
      const lineTotal = lineTotals[index] ?? { taxable: 0 };
      const taxableAfterBillDiscount = lineTotal.taxable * (1 - discountRatio);
      const cgst = gstEnabled ? taxableAfterBillDiscount * line.gstRate / 200 : 0;
      const sgst = gstEnabled ? taxableAfterBillDiscount * line.gstRate / 200 : 0;
      return {
        totalCgst: totals.totalCgst + cgst,
        totalSgst: totals.totalSgst + sgst,
      };
    },
    { totalCgst: 0, totalSgst: 0 },
  );

  const taxable = taxableBeforeBillDiscount - safeBillDiscount;
  return {
    subtotal,
    totalLineDiscount,
    billDiscount: safeBillDiscount,
    totalCgst: taxTotals.totalCgst,
    totalSgst: taxTotals.totalSgst,
    grandTotal: taxable + taxTotals.totalCgst + taxTotals.totalSgst,
  };
}
