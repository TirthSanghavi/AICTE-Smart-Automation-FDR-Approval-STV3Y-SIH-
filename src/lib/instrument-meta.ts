import type { Instrument } from "@prisma/client";
import { toIsoDate } from "./dates";

export const FIELD_LABELS: Record<string, string> = {
  bankName: "Bank name",
  branch: "Branch",
  fdrNumber: "FDR number",
  amount: "Deposit amount",
  issueDate: "Issue date",
  maturityDate: "Maturity date",
  holderName: "Holder name",
  declaredLienStatus: "Lien declared",
};

export const REQUIRED_CONFIRMATION_FIELDS = [
  "bankName",
  "fdrNumber",
  "amount",
  "issueDate",
  "maturityDate",
  "holderName",
  "declaredLienStatus",
] as const;

export const ALL_CONFIRMATION_FIELDS = [
  "bankName",
  "branch",
  "fdrNumber",
  "amount",
  "issueDate",
  "maturityDate",
  "holderName",
  "declaredLienStatus",
] as const;

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function instrumentSnapshot(instrument: Instrument): Record<string, unknown> {
  return {
    bankName: instrument.bankName,
    branch: instrument.branch,
    fdrNumber: instrument.fdrNumber,
    amount: instrument.amount.toString(),
    issueDate: toIsoDate(instrument.issueDate),
    maturityDate: toIsoDate(instrument.maturityDate),
    holderName: instrument.holderName,
    declaredLienStatus: instrument.declaredLienStatus,
    ifscCode: instrument.ifscCode,
    lifecycleStatus: instrument.lifecycleStatus,
    documentStatus: instrument.documentStatus,
    verificationStatus: instrument.verificationStatus,
    complianceStatus: instrument.complianceStatus,
    replacesId: instrument.replacesId,
    replacementReason: instrument.replacementReason,
    versionNo: instrument.versionNo,
  };
}

export const LIFECYCLE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  CORRECTION_REQUESTED: "Correction requested",
  ACTIVE: "Active",
  DISPUTED: "Disputed",
  REPLACED: "Replaced",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

export const VERIFICATION_LABEL: Record<string, string> = {
  NOT_CHECKED: "Not independently checked",
  NEEDS_REVIEW: "Needs review",
  PENDING_EXTERNAL_VERIFICATION: "Pending external verification",
  MANUAL_REVIEW_RECORDED: "Manual review recorded",
  BANK_CONFIRMED: "Bank confirmed",
  BANK_NOT_CONFIRMED: "Bank did not confirm",
  SIMULATED_RESULT: "Simulation only",
  INCONCLUSIVE: "Inconclusive",
};

export function verificationCaption(status: string): string {
  switch (status) {
    case "SIMULATED_RESULT":
      return "Simulation only — a synthetic response, not a bank confirmation.";
    case "MANUAL_REVIEW_RECORDED":
      return "Recorded by a reviewer from external evidence; not independently confirmed with the bank.";
    case "NOT_CHECKED":
      return "No independent source has been checked. Extraction is not verification.";
    case "INCONCLUSIVE":
      return "No positive or negative bank result is inferred.";
    default:
      return "Independent confirmation status is recorded separately from document extraction.";
  }
}
