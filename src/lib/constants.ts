export const ROLE = {
  INSTITUTION_ADMIN: "INSTITUTION_ADMIN",
  INSTITUTION_VIEWER: "INSTITUTION_VIEWER",
  SCRUTINY_OFFICER: "SCRUTINY_OFFICER",
  DEPT_REVIEWER: "DEPT_REVIEWER",
  COMPETENT_AUTHORITY: "COMPETENT_AUTHORITY",
  AUDITOR: "AUDITOR",
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
  SERVICE_ACCOUNT: "SERVICE_ACCOUNT",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const ALL_ROLES: Role[] = Object.values(ROLE);

export const ROLE_LABEL: Record<Role, string> = {
  INSTITUTION_ADMIN: "Institution Admin",
  INSTITUTION_VIEWER: "Institution Viewer",
  SCRUTINY_OFFICER: "Scrutiny Officer",
  DEPT_REVIEWER: "Departmental Reviewer",
  COMPETENT_AUTHORITY: "Competent Authority",
  AUDITOR: "Auditor",
  SYSTEM_ADMIN: "System Admin",
  SERVICE_ACCOUNT: "Integration Service Account",
};

export const ROLE_SHORT: Record<Role, string> = {
  INSTITUTION_ADMIN: "Institution",
  INSTITUTION_VIEWER: "Institution",
  SCRUTINY_OFFICER: "Scrutiny",
  DEPT_REVIEWER: "Reviewer",
  COMPETENT_AUTHORITY: "Authority",
  AUDITOR: "Auditor",
  SYSTEM_ADMIN: "Admin",
  SERVICE_ACCOUNT: "Service",
};

export function isRole(value: string | null | undefined): value is Role {
  return !!value && (ALL_ROLES as string[]).includes(value);
}

export function roleOf(value: string): Role {
  if (!isRole(value)) throw new Error(`Unknown role: ${value}`);
  return value;
}

export const INSTITUTION_ROLES: Role[] = [
  ROLE.INSTITUTION_ADMIN,
  ROLE.INSTITUTION_VIEWER,
];

export const INTERNAL_ROLES: Role[] = [
  ROLE.SCRUTINY_OFFICER,
  ROLE.DEPT_REVIEWER,
  ROLE.COMPETENT_AUTHORITY,
  ROLE.AUDITOR,
  ROLE.SYSTEM_ADMIN,
  ROLE.SERVICE_ACCOUNT,
];

export const LIFECYCLE = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  CORRECTION_REQUESTED: "CORRECTION_REQUESTED",
  ACTIVE: "ACTIVE",
  DISPUTED: "DISPUTED",
  REPLACED: "REPLACED",
  CLOSED: "CLOSED",
  ARCHIVED: "ARCHIVED",
} as const;

export const DOC_STATUS = {
  NONE: "NONE",
  UPLOADED: "UPLOADED",
  EXTRACTED: "EXTRACTED",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
} as const;

export const VERIFICATION = {
  NOT_CHECKED: "NOT_CHECKED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  PENDING_EXTERNAL_VERIFICATION: "PENDING_EXTERNAL_VERIFICATION",
  MANUAL_REVIEW_RECORDED: "MANUAL_REVIEW_RECORDED",
  BANK_CONFIRMED: "BANK_CONFIRMED",
  BANK_NOT_CONFIRMED: "BANK_NOT_CONFIRMED",
  SIMULATED_RESULT: "SIMULATED_RESULT",
  INCONCLUSIVE: "INCONCLUSIVE",
} as const;

export const COMPLIANCE = {
  NOT_EVALUATED: "NOT_EVALUATED",
  RULES_PENDING: "RULES_PENDING",
  FINDINGS_OPEN: "FINDINGS_OPEN",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  NO_KNOWN_FINDINGS: "NO_KNOWN_FINDINGS",
} as const;

export const CASE_STATUS = {
  OPEN: "OPEN",
  IN_REVIEW: "IN_REVIEW",
  RETURNED: "RETURNED",
  ESCALATED: "ESCALATED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
  CLOSED: "CLOSED",
} as const;

export const CASE_OPEN_STATUSES = [
  CASE_STATUS.OPEN,
  CASE_STATUS.IN_REVIEW,
  CASE_STATUS.RETURNED,
  CASE_STATUS.ESCALATED,
];

export const CASE_TYPE = {
  RELEASE: "RELEASE",
  REFUND: "REFUND",
  EXTENSION: "EXTENSION",
  OTHER: "OTHER",
} as const;

export const CASE_TYPE_LABEL: Record<string, string> = {
  RELEASE: "Release of deposit",
  REFUND: "Refund request",
  EXTENSION: "Extension request",
  OTHER: "Other request",
};

export const FINDING_STATUS = {
  OPEN: "OPEN",
  CORRECTION_REQUESTED: "CORRECTION_REQUESTED",
  RESOLVED: "RESOLVED",
  DISMISSED_FALSE_POSITIVE: "DISMISSED_FALSE_POSITIVE",
  SUPERSEDED: "SUPERSEDED",
  OVERRIDDEN: "OVERRIDDEN",
} as const;

export const SEVERITY = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  INFO: "INFO",
} as const;

export const ENDORSEMENT = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  ENDORSED: "ENDORSED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
} as const;

export const ENDORSEMENT_LABEL: Record<string, string> = {
  NOT_REQUIRED: "Not required",
  PENDING: "Awaiting officer endorsement",
  ENDORSED: "Endorsed by designated officer",
  REJECTED: "Endorsement refused",
  WITHDRAWN: "Request withdrawn",
};

/**
 * Explicit business configuration for holder structure (Stage 2.1).
 * The available project documentation does NOT confirm AICTE as a legal joint
 * account holder on these instruments, so the officer's authorization is
 * stored as a separate endorsement record and is never presented as joint
 * account ownership. Change these flags only against an authoritative source.
 */
export const HOLDER_STRUCTURE_CONFIG = {
  aicteJointHolder: false,
  mode: "SEPARATE_ENDORSEMENT",
  requiredForSubmission: false,
} as const;

export const ALERT_THRESHOLDS = [90, 60, 30] as const;

export const DEMO_PASSWORD = "Demo@1234";

export const SYNTHETIC_BANNER =
  "SYNTHETIC DEMO DATA — NOT LIVE AICTE/BANK DATA";

export const CASE_DISCLAIMER =
  "This action records an administrative decision in the prototype. It does not issue a bank instruction, confirm lien status, or transfer funds.";

export const CHECK_LIMITATION =
  "Checks compare data consistency. They do not establish that the document is genuine.";

export function statusTone(value: string | null | undefined): string {
  switch (value) {
    case "ACTIVE":
    case "APPROVED":
    case "RESOLVED":
    case "NO_KNOWN_FINDINGS":
    case "CONFIRMED":
    case "SENT":
    case "COMPLETED":
      return "good";
    case "DRAFT":
    case "NOT_CHECKED":
    case "NOT_EVALUATED":
    case "PENDING":
    case "UPCOMING":
    case "UNKNOWN":
      return "neutral";
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "IN_REVIEW":
    case "OPEN":
    case "EXTRACTED":
    case "MATURING":
    case "MANUAL_REVIEW_RECORDED":
    case "RULES_PENDING":
    case "RETURNED":
    case "ESCALATED":
      return "attention";
    case "CORRECTION_REQUESTED":
    case "FINDINGS_OPEN":
    case "REVIEW_REQUIRED":
    case "MATURED":
    case "EXTRACTION_FAILED":
    case "BANK_NOT_CONFIRMED":
    case "INCONCLUSIVE":
    case "REJECTED":
    case "CRITICAL":
    case "HIGH":
      return "critical";
    case "SIMULATED_RESULT":
    case "PENDING_EXTERNAL_VERIFICATION":
      return "simulated";
    case "ENDORSED":
      return "good";
    case "NOT_REQUIRED":
      return "muted";
    case "CLOSED":
    case "REPLACED":
    case "ARCHIVED":
    case "WITHDRAWN":
    case "SUPERSEDED":
      return "muted";
    default:
      return "neutral";
  }
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
