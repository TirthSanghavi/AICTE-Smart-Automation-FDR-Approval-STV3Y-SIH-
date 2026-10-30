export function formatMoney(
  value: string | number | { toString(): string } | null | undefined,
  options?: { compact?: boolean },
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value.toString().replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "—";
  if (options?.compact) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: numeric >= 100000 ? 1 : 0,
      notation: numeric >= 100000 ? "compact" : "standard",
    }).format(numeric);
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(numeric);
}

/** Accepts "3500000", "35,00,000.00", or numeric input. Returns null if invalid. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}
