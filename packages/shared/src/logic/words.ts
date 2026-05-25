const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underHundred(n: number): string {
  if (n < 20) return ones[n] ?? "";
  return [tens[Math.floor(n / 10)] ?? "", ones[n % 10] ?? ""].filter(Boolean).join(" ");
}

function underThousand(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return [
    hundred ? `${ones[hundred] ?? ""} Hundred` : "",
    rest ? underHundred(rest) : "",
  ].filter(Boolean).join(" ");
}

export function numberToWords(n: number): string {
  const whole = Math.floor(Math.abs(n));
  if (whole === 0) return "Zero";

  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1_000);
  const rest = whole % 1_000;
  const parts = [
    crore ? `${underThousand(crore)} Crore` : "",
    lakh ? `${underThousand(lakh)} Lakh` : "",
    thousand ? `${underThousand(thousand)} Thousand` : "",
    rest ? underThousand(rest) : "",
  ].filter(Boolean);
  return `${n < 0 ? "Minus " : ""}${parts.join(" ")}`;
}
