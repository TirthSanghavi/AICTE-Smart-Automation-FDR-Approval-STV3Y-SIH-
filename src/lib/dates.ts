export const IST_TIMEZONE = "Asia/Kolkata";
export const DAY_MS = 86_400_000;

/** A calendar date is represented as a UTC midnight Date. */
export function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function startOfUtcDay(value: Date): Date {
  return dateOnly(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

/** Today's calendar date in Asia/Kolkata, represented as UTC midnight. */
export function todayInIST(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return dateOnly(get("year"), get("month"), get("day"));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Signed whole days from `from` to `to` (b - a). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

export function parseIsoDate(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("INVALID_DATE");
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = dateOnly(y, m, d);
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) {
    throw new Error("INVALID_DATE");
  }
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: IST_TIMEZONE,
    timeZoneName: "short",
  }).format(d);
}

export function formatRelativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export type MaturityBucket =
  | "UPCOMING"
  | "MATURING"
  | "MATURED"
  | "DATE_NOT_APPLICABLE";

export function deriveMaturity(
  maturityDate: Date,
  today: Date,
): { bucket: MaturityBucket; days: number; label: string } {
  const days = daysBetween(today, maturityDate);
  if (days < 0) {
    return {
      bucket: "MATURED",
      days,
      label: days === -1 ? "Matured yesterday" : `Matured ${Math.abs(days)} days ago`,
    };
  }
  if (days <= 90) {
    return {
      bucket: "MATURING",
      days,
      label: days === 0 ? "Matures today" : `Matures in ${days} days`,
    };
  }
  return {
    bucket: "UPCOMING",
    days,
    label: `Matures ${formatDate(maturityDate)}`,
  };
}
