/**
 * CSV emission with two safety properties:
 * 1. RFC-4180 quoting — commas, quotes and line breaks survive a round trip.
 * 2. Formula-injection guard — cells starting with =, +, -, @, tab or CR are
 *    prefixed with a single quote so spreadsheets treat them as text.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvLine(cells: unknown[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
