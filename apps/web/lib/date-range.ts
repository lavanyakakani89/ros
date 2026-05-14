export function inputDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

export function defaultFromDate(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return inputDateValue(date);
}

export function todayDate(): string {
  return inputDateValue(new Date());
}

export function appendDateRange(params: URLSearchParams, from: string, to: string) {
  if (from) {
    const start = parseInputDate(from);
    start.setHours(0, 0, 0, 0);
    params.set("from", start.toISOString());
  }

  if (to) {
    const end = parseInputDate(to);
    end.setHours(23, 59, 59, 999);
    params.set("to", end.toISOString());
  }
}

function parseInputDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, day ?? 1);
}
