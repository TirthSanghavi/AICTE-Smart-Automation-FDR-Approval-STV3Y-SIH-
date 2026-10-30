import { parseIsoDate } from "./dates";
import { parseAmount } from "./money";
import type { ErrorDetail } from "./errors";

export type InstrumentInput = {
  bankName: string;
  branch: string | null;
  fdrNumber: string;
  ifscCode: string | null;
  amount: number;
  issueDate: Date;
  maturityDate: Date;
  holderName: string;
  declaredLienStatus: "YES" | "NO" | "UNKNOWN";
};

const LIEN_VALUES = new Set(["YES", "NO", "UNKNOWN"]);

/**
 * IFSC format validation only: 4 letters + '0' + 5 alphanumeric
 * (e.g. HDFC0001234). This does NOT prove the code belongs to a real branch
 * or that any bank authenticated the instrument — authoritative directory
 * lookup is an explicitly unimplemented integration boundary.
 */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function normalizeIfsc(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidIfsc(value: string): boolean {
  return IFSC_PATTERN.test(normalizeIfsc(value));
}

export function normalizeBank(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeFdr(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function validateInstrumentInput(body: Record<string, unknown>): {
  value?: InstrumentInput;
  errors: ErrorDetail[];
} {
  const errors: ErrorDetail[] = [];
  const bankName = typeof body.bankName === "string" ? body.bankName.trim() : "";
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  const fdrNumber = typeof body.fdrNumber === "string" ? body.fdrNumber.trim() : "";
  const rawIfsc = typeof body.ifscCode === "string" ? body.ifscCode.trim() : "";
  const holderName = typeof body.holderName === "string" ? body.holderName.trim() : "";
  const lien = typeof body.declaredLienStatus === "string" ? body.declaredLienStatus.toUpperCase() : "UNKNOWN";

  if (!bankName) errors.push({ field: "bankName", issue: "Bank name is required." });
  if (bankName.length > 160) errors.push({ field: "bankName", issue: "Use 160 characters or fewer." });
  if (!fdrNumber) errors.push({ field: "fdrNumber", issue: "FDR number is required." });
  if (fdrNumber.length > 80) errors.push({ field: "fdrNumber", issue: "Use 80 characters or fewer." });
  if (!holderName) errors.push({ field: "holderName", issue: "Account holder name is required." });
  if (holderName.length > 200) errors.push({ field: "holderName", issue: "Use 200 characters or fewer." });
  if (!LIEN_VALUES.has(lien)) {
    errors.push({ field: "declaredLienStatus", issue: "Choose YES, NO or UNKNOWN." });
  }

  let ifscCode: string | null = null;
  if (rawIfsc) {
    const normalized = normalizeIfsc(rawIfsc);
    if (!IFSC_PATTERN.test(normalized)) {
      errors.push({
        field: "ifscCode",
        issue:
          "Enter a valid IFSC: 11 characters — four letters, then 0, then five letters or digits (e.g. HDFC0001234). Format only; the branch is not verified.",
      });
    } else {
      ifscCode = normalized;
    }
  }

  const amount = parseAmount(body.amount);
  if (amount === null) {
    errors.push({ field: "amount", issue: "Enter a valid amount with up to two decimal places." });
  } else if (amount <= 0) {
    errors.push({ field: "amount", issue: "Amount must be greater than zero." });
  } else if (amount > 999_999_999_999.99) {
    errors.push({ field: "amount", issue: "Amount exceeds the supported range." });
  }

  let issueDate: Date | null = null;
  let maturityDate: Date | null = null;
  try {
    issueDate = parseIsoDate(body.issueDate);
  } catch {
    errors.push({ field: "issueDate", issue: "Enter a valid issue date." });
  }
  try {
    maturityDate = parseIsoDate(body.maturityDate);
  } catch {
    errors.push({ field: "maturityDate", issue: "Enter a valid maturity date." });
  }
  if (issueDate && maturityDate && maturityDate.getTime() <= issueDate.getTime()) {
    errors.push({ field: "maturityDate", issue: "Maturity date must be after the issue date." });
  }

  if (errors.length > 0 || amount === null || !issueDate || !maturityDate) {
    return { errors };
  }

  return {
    errors: [],
    value: {
      bankName,
      branch: branch || null,
      fdrNumber,
      ifscCode,
      amount,
      issueDate,
      maturityDate,
      holderName,
      declaredLienStatus: lien as "YES" | "NO" | "UNKNOWN",
    },
  };
}
