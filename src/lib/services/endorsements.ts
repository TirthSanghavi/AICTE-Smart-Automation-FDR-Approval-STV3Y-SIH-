import { prisma } from "../db";
import { appendAudit, auditTransaction } from "../audit";
import {
  ENDORSEMENT,
  ENDORSEMENT_LABEL,
  HOLDER_STRUCTURE_CONFIG,
  ROLE,
} from "../constants";
import { forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";

const INSTITUTION_REQUEST_STATUSES = [ENDORSEMENT.PENDING, ENDORSEMENT.WITHDRAWN];
const OFFICER_DECISION_STATUSES = [
  ENDORSEMENT.ENDORSED,
  ENDORSEMENT.REJECTED,
  ENDORSEMENT.NOT_REQUIRED,
];

export type EndorsementRow = Awaited<ReturnType<typeof getEndorsement>>;

export async function getEndorsement(instrumentId: string) {
  return prisma.holderEndorsement.findUnique({ where: { instrumentId } });
}

function assertCanAct(user: SessionUser, status: string): void {
  const isInstitution = user.role === ROLE.INSTITUTION_ADMIN;
  const isOfficer =
    user.role === ROLE.SCRUTINY_OFFICER || user.role === ROLE.COMPETENT_AUTHORITY;

  if (isInstitution) {
    if (!INSTITUTION_REQUEST_STATUSES.includes(status as never)) {
      throw forbidden("endorsement", status);
    }
    return;
  }
  if (isOfficer) {
    if (!OFFICER_DECISION_STATUSES.includes(status as never)) {
      throw forbidden("endorsement", status);
    }
    return;
  }
  throw forbidden("endorsement", user.role);
}

/**
 * Records the AICTE officer endorsement as a separate authorization record
 * (never as joint account ownership — see HOLDER_STRUCTURE_CONFIG). One row
 * per instrument; every transition is audited with before/after in the same
 * transaction. Officer identity and reference come from the acting user's own
 * submission — nothing is fabricated by the system.
 */
export async function recordEndorsement(
  user: SessionUser,
  instrumentId: string,
  body: Record<string, unknown>,
) {
  const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
  if (!Object.values(ENDORSEMENT).includes(status as never)) {
    throw invalid("Choose a valid endorsement status.", [
      { field: "status", issue: `Status must be one of: ${Object.values(ENDORSEMENT).join(", ")}.` },
    ]);
  }
  assertCanAct(user, status);

  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    select: { id: true, institutionId: true },
  });
  if (!instrument) throw notFound();
  if (
    user.role === ROLE.INSTITUTION_ADMIN &&
    instrument.institutionId !== user.institutionId
  ) {
    throw forbidden("endorsement", instrumentId);
  }

  const str = (key: string, max: number) => {
    const raw = body[key];
    if (typeof raw !== "string" || !raw.trim()) return null;
    return raw.trim().slice(0, max);
  };
  const officerName = str("officerName", 160);
  const officerReference = str("officerReference", 80);
  const documentRef = str("documentRef", 200);
  const remarks = str("remarks", 1000);

  const errors: { field: string; issue: string }[] = [];
  if (status === ENDORSEMENT.ENDORSED) {
    if (!officerName) errors.push({ field: "officerName", issue: "Designated officer name is required to record an endorsement." });
    if (!officerReference) errors.push({ field: "officerReference", issue: "Officer designation or authorization reference is required." });
  }
  if (status === ENDORSEMENT.REJECTED && !remarks) {
    errors.push({ field: "remarks", issue: "A refusal must state the reason." });
  }
  if (errors.length > 0) throw invalid("Check the highlighted fields.", errors);

  return auditTransaction(async (tx) => {
    const existing = await tx.holderEndorsement.findUnique({ where: { instrumentId } });
    const before = existing;
    const data = {
      status,
      officerName: status === ENDORSEMENT.ENDORSED ? officerName : existing?.officerName ?? officerName,
      officerReference:
        status === ENDORSEMENT.ENDORSED ? officerReference : existing?.officerReference ?? officerReference,
      endorsedAt:
        status === ENDORSEMENT.ENDORSED ? existing?.endorsedAt ?? new Date() : existing?.endorsedAt ?? null,
      documentRef: documentRef ?? existing?.documentRef ?? null,
      remarks: remarks ?? existing?.remarks ?? null,
    };
    const after = existing
      ? await tx.holderEndorsement.update({ where: { instrumentId }, data })
      : await tx.holderEndorsement.create({
          data: { instrumentId, recordedBy: user.id, ...data },
        });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "endorsement.recorded",
      entityType: "endorsement",
      entityId: after.id,
      before: before
        ? { status: before.status, officerName: before.officerName, officerReference: before.officerReference }
        : null,
      after: { status: after.status, officerName: after.officerName, officerReference: after.officerReference },
      reason: remarks,
    });
    return after;
  });
}

export function endorsementCaption(status: string | null | undefined): string {
  if (!status) {
    return HOLDER_STRUCTURE_CONFIG.requiredForSubmission
      ? "An officer endorsement is required before submission under the configured policy."
      : "No endorsement recorded. Under the configured policy an endorsement is recorded only when the applicable process requires it.";
  }
  switch (status) {
    case ENDORSEMENT.ENDORSED:
      return "A designated officer recorded an authorization for this instrument. This is an administrative record, not proof of joint account ownership.";
    case ENDORSEMENT.PENDING:
      return "The institution requested an endorsement; a designated officer must record the decision.";
    case ENDORSEMENT.REJECTED:
      return "The endorsement was refused; see the recorded reason before resubmitting.";
    default:
      return ENDORSEMENT_LABEL[status] ?? "Endorsement state is recorded separately from verification.";
  }
}
