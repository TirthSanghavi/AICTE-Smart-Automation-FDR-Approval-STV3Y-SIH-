import { prisma } from "../db";
import { appendAudit, auditTransaction, notifyUsers } from "../audit";
import { LIFECYCLE, ROLE, VERIFICATION } from "../constants";
import { conflict, forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";
import { instrumentSnapshot } from "../instrument-meta";
import { simulateBankVerification } from "../adapters/bank";
import { countOpenBlocking } from "../rules/discrepancy";

export type VerificationInput = {
  method: "SIMULATED" | "MANUAL_CONFIRMATION" | "OFFICIAL_BANK_API";
  sourceName: string;
  reference: string;
  asOf: Date;
  notes: string;
  limitations: string;
  evidenceDocumentId: string | null;
  overrideReason: string | null;
};

export async function recordVerification(
  user: SessionUser,
  instrumentId: string,
  input: VerificationInput,
) {
  const verifyRoles: string[] = [ROLE.SCRUTINY_OFFICER, ROLE.COMPETENT_AUTHORITY, ROLE.SERVICE_ACCOUNT];
  if (!verifyRoles.includes(user.role)) {
    throw forbidden("instrument", instrumentId);
  }
  if (input.method === "OFFICIAL_BANK_API") {
    throw invalid("No authorized live bank interface is configured for this prototype.", [
      {
        field: "method",
        issue: "Use SIMULATED or MANUAL_CONFIRMATION. A live bank API would require a separate authorized integration.",
      },
    ]);
  }

  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    include: { findings: true, institution: true },
  });
  if (!instrument) throw notFound();
  if (![LIFECYCLE.SUBMITTED, LIFECYCLE.UNDER_REVIEW].includes(instrument.lifecycleStatus as never)) {
    throw conflict(
      "INVALID_TRANSITION",
      "A verification outcome can only be recorded while the record is submitted or under review.",
    );
  }

  const blocking = countOpenBlocking(instrument.findings);
  if (blocking > 0 && !input.overrideReason) {
    throw conflict(
      "FINDINGS_BLOCKING_VERIFICATION",
      "Open critical findings block verification. Resolve the finding or record an authorized override with a reason.",
      [{ field: "findings", issue: `${blocking} open critical finding(s).` }],
    );
  }
  if (blocking > 0 && user.role !== ROLE.COMPETENT_AUTHORITY) {
    throw forbidden("instrument", instrumentId);
  }

  let status: string;
  let lienStatus = "UNKNOWN";
  let simulated = false;
  let sourceName = input.sourceName;
  let reference = input.reference;
  let limitations = input.limitations;
  let notes = input.notes;
  let outcomeHealthy = true;

  if (input.method === "SIMULATED") {
    const result = await simulateBankVerification({
      fdrNumber: instrument.fdrNumber,
      bankName: instrument.bankName,
      amount: instrument.amount,
      requestId: `ver-${instrumentId}-${Date.now()}`,
    });
    simulated = true;
    sourceName = result.sourceName;
    reference = result.reference;
    lienStatus = result.lienStatus;
    limitations =
      "Synthetic simulator output. Not a bank confirmation, lien confirmation or proof of funds.";
    notes = `${result.notes} Attempts: ${result.attempts}.`;
    if (result.status === "CONFIRMED") {
      status = VERIFICATION.SIMULATED_RESULT;
    } else {
      status = VERIFICATION.INCONCLUSIVE;
      outcomeHealthy = false;
      limitations = `${limitations} ${result.errorCode ?? ""}`.trim();
    }
  } else {
    status = VERIFICATION.MANUAL_REVIEW_RECORDED;
    lienStatus = "UNKNOWN";
    limitations =
      input.limitations ||
      "Recorded by a reviewer from the stated source. Not independently confirmed with the bank.";
    if (input.evidenceDocumentId) {
      const evidence = await prisma.documentVersion.findFirst({
        where: { id: input.evidenceDocumentId, instrumentId },
      });
      if (!evidence) {
        throw invalid("The evidence document does not belong to this instrument.", [
          { field: "evidenceDocumentId", issue: "Choose an attached document for this record." },
        ]);
      }
    }
  }

  return auditTransaction(async (tx) => {
    const attempt = await tx.verificationAttempt.create({
      data: {
        instrumentId,
        method: input.method,
        status,
        lienStatus,
        sourceName,
        reference,
        asOf: input.asOf,
        simulated,
        byUser: user.id,
        notes,
        limitations,
        evidenceDocumentId: input.evidenceDocumentId,
      },
    });

    const nextLifecycle = outcomeHealthy
      ? LIFECYCLE.ACTIVE
      : LIFECYCLE.UNDER_REVIEW;
    const after = await tx.instrument.update({
      where: { id: instrumentId },
      data: {
        verificationStatus: status,
        lifecycleStatus:
          instrument.lifecycleStatus === LIFECYCLE.SUBMITTED && outcomeHealthy
            ? LIFECYCLE.ACTIVE
            : nextLifecycle,
        versionNo: { increment: 1 },
      },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: `Verification outcome recorded (${input.method})`,
      },
    });
    if (input.overrideReason) {
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: "verification.override",
        entityType: "instrument",
        entityId: instrumentId,
        after: { criticalFindingsOpen: blocking, verificationStatus: status },
        reason: input.overrideReason,
      });
    }
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "verification.recorded",
      entityType: "verification_attempt",
      entityId: attempt.id,
      before: { verificationStatus: instrument.verificationStatus },
      after: {
        instrumentId,
        method: input.method,
        status,
        lienStatus,
        simulated,
        reference,
        sourceName,
      },
      reason: input.notes || null,
    });

    const admins = await tx.user.findMany({
      where: {
        institutionId: instrument.institutionId,
        role: ROLE.INSTITUTION_ADMIN,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await notifyUsers(tx, admins.map((a) => a.id), {
      type: "VERIFICATION_RECORDED",
      title: simulated
        ? "Simulated verification result recorded"
        : "Manual review recorded",
      body: `${instrument.fdrNumber}: ${simulated ? "Simulation only — not a bank confirmation." : "A reviewer recorded manual evidence; this is not independently confirmed with the bank."}`,
      dedupeKey: `verification:${attempt.id}`,
    });

    return { attempt, instrument: after };
  });
}
