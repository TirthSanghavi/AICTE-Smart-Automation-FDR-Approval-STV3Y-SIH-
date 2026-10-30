import { daysBetween, formatDate } from "../dates";
import { SEVERITY } from "../constants";

export type FindingDraft = {
  ruleId: string;
  field: string | null;
  observed: string | null;
  expected: string | null;
  basis: string | null;
  severity: string;
  explanation: string;
  recommendedAction: string;
};

export type DuplicateCandidate = {
  id: string;
  fdrNumber: string;
  bankName: string;
  institutionName: string;
};

export type ExtractionDiff = {
  field: string;
  extracted: string;
  confirmed: string;
};

export type LowConfidenceField = {
  field: string;
  value: string;
  confidence: number;
};

export type DiscrepancyInput = {
  instrument: {
    id: string;
    bankName: string;
    fdrNumber: string;
    amount: number;
    issueDate: Date;
    maturityDate: Date;
    holderName: string;
    declaredLienStatus: string;
  };
  institutionName: string;
  today: Date;
  duplicates: DuplicateCandidate[];
  extractionDiffs: ExtractionDiff[];
  lowConfidence: LowConfidenceField[];
  conflictingVerification: { sourceName: string; status: string } | null;
  labelForField: (field: string) => string;
};

const HOLDER_NOISE = new Set([
  "the",
  "of",
  "and",
  "trust",
  "society",
  "societies",
  "pvt",
  "private",
  "ltd",
  "limited",
]);

export function holderSimilarity(a: string, b: string): number {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((token) => token && !HOLDER_NOISE.has(token)),
    );
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/**
 * Deterministic consistency checks. Findings are explanations, not proof of
 * authenticity, and duplicates are routed to human review rather than rejected.
 */
export function evaluateDiscrepancies(input: DiscrepancyInput): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const { instrument, today } = input;
  const label = input.labelForField;

  if (!Number.isFinite(instrument.amount) || instrument.amount <= 0) {
    findings.push({
      ruleId: "DR-02",
      field: "amount",
      observed: String(instrument.amount),
      expected: "An amount greater than zero",
      basis: "Basic record validation",
      severity: SEVERITY.HIGH,
      explanation: "The recorded deposit amount is zero, negative or not a valid number.",
      recommendedAction: "Correct the amount using the FDR document, then resubmit.",
    });
  }

  if (instrument.maturityDate.getTime() <= instrument.issueDate.getTime()) {
    findings.push({
      ruleId: "DR-03",
      field: "maturityDate",
      observed: formatDate(instrument.maturityDate),
      expected: `A date after the issue date (${formatDate(instrument.issueDate)})`,
      basis: "Date ordering check",
      severity: SEVERITY.CRITICAL,
      explanation: `Maturity date (${formatDate(instrument.maturityDate)}) is not after the issue date (${formatDate(instrument.issueDate)}).`,
      recommendedAction:
        "Check the document and correct the dates, or upload a clearer copy.",
    });
  } else if (daysBetween(today, instrument.maturityDate) < 0) {
    findings.push({
      ruleId: "DR-04",
      field: "maturityDate",
      observed: formatDate(instrument.maturityDate),
      expected: "Maturity on or after submission date",
      basis: "Date-derived check at submission",
      severity: SEVERITY.HIGH,
      explanation: `The FDR matured on ${formatDate(instrument.maturityDate)} and the record has no recorded renewal or release action.`,
      recommendedAction:
        "Confirm whether the deposit was renewed, released, or is awaiting action before treating it as current.",
    });
  }

  if (holderSimilarity(instrument.holderName, input.institutionName) < 0.5) {
    findings.push({
      ruleId: "DR-05",
      field: "holderName",
      observed: instrument.holderName,
      expected: input.institutionName,
      basis: "Name comparison against the registered institution name (fuzzy, configurable)",
      severity: SEVERITY.HIGH,
      explanation: `The FDR holder (“${instrument.holderName}”) differs from the registered institution name (“${input.institutionName}”).`,
      recommendedAction:
        "Confirm the legal holder name on the FDR and record why it differs, or request correction.",
    });
  }

  for (const duplicate of input.duplicates) {
    findings.push({
      ruleId: "DR-06",
      field: "fdrNumber",
      observed: `${instrument.fdrNumber} at ${instrument.bankName}`,
      expected: "No matching bank + FDR number",
      basis: `Possible match with ${duplicate.fdrNumber} at ${duplicate.bankName} (${duplicate.institutionName})`,
      severity: SEVERITY.CRITICAL,
      explanation:
        "This bank and FDR number already appear on another record. Nothing has been overwritten; the match needs human review.",
      recommendedAction:
        "Open both records and confirm whether this is a true duplicate, a data-entry error, or a legitimate reissue.",
    });
  }

  for (const diff of input.extractionDiffs) {
    findings.push({
      ruleId: "DR-07",
      field: diff.field,
      observed: `Extracted: ${diff.extracted}`,
      expected: `Confirmed: ${diff.confirmed}`,
      basis: "Extraction vs institution-confirmed value",
      severity: SEVERITY.INFO,
      explanation: `The confirmed ${label(diff.field).toLowerCase()} differs from the mock extraction. Both values are preserved.`,
      recommendedAction:
        "No action required if the confirmed value is correct; a reviewer may ask for the source.",
    });
  }

  for (const field of input.lowConfidence) {
    findings.push({
      ruleId: "DR-10",
      field: field.field,
      observed: `${field.value} (${Math.round(field.confidence * 100)}% confidence)`,
      expected: "Human confirmation",
      basis: "Mock extraction confidence threshold (0.70)",
      severity: SEVERITY.INFO,
      explanation: `Extraction confidence for ${label(field.field).toLowerCase()} is low. Confidence is not an authenticity score.`,
      recommendedAction:
        "Confirm the field against the document; upload a clearer copy if needed.",
    });
  }

  if (input.conflictingVerification) {
    findings.push({
      ruleId: "DR-11",
      field: null,
      observed: `${input.conflictingVerification.status} from ${input.conflictingVerification.sourceName}`,
      expected: "No conflicting independent source",
      basis: "Existing verification attempt",
      severity: SEVERITY.CRITICAL,
      explanation:
        "A previously recorded independent source result conflicts with the submitted record.",
      recommendedAction:
        "Resolve the conflicting evidence with the competent authority before relying on this record.",
    });
  }

  return findings;
}

export function hasBlockingFindings(
  findings: { ruleId: string; severity: string; resolutionStatus: string }[],
): boolean {
  return findings.some(
    (finding) =>
      finding.ruleId === "DR-03" ||
      (finding.severity === "CRITICAL" &&
        ["OPEN", "CORRECTION_REQUESTED"].includes(finding.resolutionStatus)),
  );
}

export function countOpenBlocking(
  findings: { severity: string; resolutionStatus: string }[],
): number {
  return findings.filter(
    (finding) =>
      finding.severity === "CRITICAL" &&
      ["OPEN", "CORRECTION_REQUESTED"].includes(finding.resolutionStatus),
  ).length;
}
