import { z } from "zod";

const INDIA_TIME_ZONE = "Asia/Kolkata";

export function dateParamSchema(boundary: "start" | "end") {
  return z.preprocess((value) => parseDateParam(value, boundary), z.date().optional());
}

export function defaultBusinessRange(daysBack: number, now = new Date()): { gte: Date; lte: Date } {
  const today = datePartInIndia(now);
  return {
    gte: dateOnlyToIndiaBoundary(addDays(today, -daysBack), "start"),
    lte: dateOnlyToIndiaBoundary(today, "end"),
  };
}

export function datePartInIndia(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDateParam(value: unknown, boundary: "start" | "end"): Date | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateOnlyToIndiaBoundary(value, boundary);
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateOnlyToIndiaBoundary(date: string, boundary: "start" | "end"): Date {
  const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
  return new Date(`${date}T${time}+05:30`);
}

function addDays(date: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return utcDate.toISOString().slice(0, 10);
}
