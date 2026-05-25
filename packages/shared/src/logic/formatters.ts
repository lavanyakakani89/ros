export function formatCurrency(n: number): string {
  const fixed = Number.isFinite(n) ? n.toFixed(2) : "0.00";
  const [whole = "0", fraction = "00"] = fixed.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${groupedRest},${lastThree}` : lastThree;
  return `₹${sign}${grouped}.${fraction}`;
}

export function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}-${month}-${year}`;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}
