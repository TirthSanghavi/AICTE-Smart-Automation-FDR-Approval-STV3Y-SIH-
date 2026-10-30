import { prisma } from "../db";
import { appendAudit, auditTransaction } from "../audit";
import { COMPLIANCE, DOC_STATUS, LIFECYCLE, ROLE } from "../constants";
import { conflict, forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";
import { validateInstrumentInput } from "../validation";
import { instrumentSnapshot } from "../instrument-meta";

/**
 * States that may NOT be replaced: a draft was never a real instrument,
 * an archived record was withdrawn from the register, and a replaced record
 * already has a successor (so replacing it would fork the chain).
 */
export const INELIGIBLE_PREDECESSOR_STATES = [
  LIFECYCLE.DRAFT,
  LIFECYCLE.ARCHIVED,
  LIFECYCLE.REPLACED,
] as const;

export function replacementEligible(
  lifecycleStatus: string,
  successorCount: number,
): boolean {
  return (
    !(INELIGIBLE_PREDECESSOR_STATES as readonly string[]).includes(lifecycleStatus) &&
    successorCount === 0
  );
}

function assertManage(user: SessionUser) {
  if (user.role !== ROLE.INSTITUTION_ADMIN || !user.institutionId) {
    throw forbidden("instrument", "replace");
  }
}

/**
 * Creates a NEW successor record linked to the predecessor via `replacesId`
 * and only then marks the predecessor `REPLACED` — all inside one transaction,
 * with the predecessor flip guarded by `updateMany` so a concurrent second
 * attempt loses the guard (count 0) and rolls back without touching anything.
 * The predecessor's documents, findings, verifications and history are never
 * modified or deleted.
 */
export async function replaceInstrument(
  user: SessionUser,
  predecessorId: string,
  body: Record<string, unknown>,
) {
  assertManage(user);

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const reasonErrors = [];
  if (reason.length < 10) {
    reasonErrors.push({ field: "reason", issue: "Give a replacement reason of at least 10 characters." });
  }
  if (reason.length > 1000) {
    reasonErrors.push({ field: "reason", issue: "Use 1000 characters or fewer." });
  }
  const { value, errors } = validateInstrumentInput(body);
  const allErrors = [...reasonErrors, ...errors];
  if (!value || allErrors.length > 0) {
    throw invalid("Check the highlighted fields.", allErrors);
  }

  const predecessor = await prisma.instrument.findFirst({
    where: { id: predecessorId },
    include: { replacedBy: { select: { id: true } } },
  });
  if (!predecessor) throw notFound();
  if (predecessor.institutionId !== user.institutionId) {
    // Mirrors rbac.getVisibleInstrument: existing-but-out-of-scope is 403 so
    // withApi records an access.denied audit event; unknown ids stay 404.
    throw forbidden("instrument", predecessorId);
  }
  if (!replacementEligible(predecessor.lifecycleStatus, predecessor.replacedBy.length)) {
    throw conflict(
      predecessor.replacedBy.length > 0 ? "ALREADY_REPLACED" : "INVALID_TRANSITION",
      predecessor.replacedBy.length > 0
        ? "This record already has a replacement. Open the existing successor instead of creating another."
        : `A record in state ${predecessor.lifecycleStatus} cannot be replaced.`,
    );
  }

  return auditTransaction(async (tx) => {
    // Guarded flip: the relation + state predicates make this a compare-and-set.
    const guarded = await tx.instrument.updateMany({
      where: {
        id: predecessorId,
        institutionId: user.institutionId!,
        replacedBy: { none: {} },
        lifecycleStatus: { notIn: [...INELIGIBLE_PREDECESSOR_STATES] },
      },
      data: {
        lifecycleStatus: LIFECYCLE.REPLACED,
        replacedAt: new Date(),
        replacedById: user.id,
        versionNo: { increment: 1 },
      },
    });
    if (guarded.count === 0) {
      throw conflict(
        "ALREADY_REPLACED",
        "This record was replaced or changed while you were editing. Reload and try again.",
      );
    }

    const before = predecessor;
    const afterPredecessor = await tx.instrument.findUniqueOrThrow({
      where: { id: predecessorId },
    });

    const successor = await tx.instrument.create({
      data: {
        institutionId: predecessor.institutionId,
        bankName: value.bankName,
        normalizedBank: normalize(value.bankName),
        branch: value.branch,
        fdrNumber: value.fdrNumber,
        normalizedFdr: normalizeFdr(value.fdrNumber),
        ifscCode: value.ifscCode,
        amount: value.amount,
        issueDate: value.issueDate,
        maturityDate: value.maturityDate,
        holderName: value.holderName,
        declaredLienStatus: value.declaredLienStatus,
        lifecycleStatus: LIFECYCLE.DRAFT,
        documentStatus: DOC_STATUS.NONE,
        verificationStatus: "NOT_CHECKED",
        complianceStatus: COMPLIANCE.NOT_EVALUATED,
        replacesId: predecessorId,
        replacementReason: reason,
        createdBy: user.id,
        versionNo: 1,
      },
    });

    await tx.instrumentHistory.create({
      data: {
        instrumentId: successor.id,
        versionNo: 1,
        snapshot: JSON.stringify(instrumentSnapshot(successor)),
        changedBy: user.id,
        reason: `Replacement for ${predecessor.fdrNumber}`,
      },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: predecessorId,
        versionNo: afterPredecessor.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(afterPredecessor)),
        changedBy: user.id,
        reason: `Replaced by ${value.fdrNumber}`,
      },
    });

    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "instrument.replaced",
      entityType: "instrument",
      entityId: predecessorId,
      before: instrumentSnapshot(before),
      after: instrumentSnapshot(afterPredecessor),
      reason,
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "instrument.replacement_created",
      entityType: "instrument",
      entityId: successor.id,
      after: instrumentSnapshot(successor),
      reason: `Replaces ${predecessor.fdrNumber}`,
    });

    return successor;
  });
}

function normalize(bankName: string): string {
  return bankName.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function normalizeFdr(fdrNumber: string): string {
  return fdrNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
