import { prisma } from "../db";
import { appendAudit, auditTransaction, notifyUsers } from "../audit";
import { COMPLIANCE, LIFECYCLE, ROLE } from "../constants";
import { conflict, forbidden, notFound } from "../errors";
import type { SessionUser } from "../auth";
import { instrumentSnapshot } from "../instrument-meta";

export async function requestCorrection(
  user: SessionUser,
  findingId: string,
  input: { reason: string; dueDate: Date | null; requestedFields: string[] },
) {
  if (user.role !== ROLE.SCRUTINY_OFFICER) throw forbidden("finding", findingId);
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    include: { instrument: true },
  });
  if (!finding) throw notFound();
  if (!["OPEN"].includes(finding.resolutionStatus)) {
    throw conflict("INVALID_TRANSITION", "Only an open finding can receive a correction request.");
  }
  if (![LIFECYCLE.SUBMITTED, LIFECYCLE.UNDER_REVIEW].includes(finding.instrument.lifecycleStatus as never)) {
    throw conflict("INVALID_TRANSITION", "The instrument is not in review.");
  }

  return auditTransaction(async (tx) => {
    await tx.finding.update({
      where: { id: findingId },
      data: {
        resolutionStatus: "CORRECTION_REQUESTED",
        correctionDueDate: input.dueDate,
      },
    });
    const after = await tx.instrument.update({
      where: { id: finding.instrumentId },
      data: {
        lifecycleStatus: LIFECYCLE.CORRECTION_REQUESTED,
        versionNo: { increment: 1 },
      },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: finding.instrumentId,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: `Correction requested: ${input.reason}`,
      },
    });
    const admins = await tx.user.findMany({
      where: {
        institutionId: finding.instrument.institutionId,
        role: ROLE.INSTITUTION_ADMIN,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await notifyUsers(tx, admins.map((a) => a.id), {
      type: "CORRECTION_REQUESTED",
      title: "Correction requested on a submitted FDR",
      body: `${finding.instrument.fdrNumber}: ${input.reason}`,
      dedupeKey: `correction:${findingId}`,
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "finding.correction_requested",
      entityType: "finding",
      entityId: findingId,
      before: { resolutionStatus: finding.resolutionStatus },
      after: {
        resolutionStatus: "CORRECTION_REQUESTED",
        requestedFields: input.requestedFields,
        dueDate: input.dueDate?.toISOString() ?? null,
        instrumentId: finding.instrumentId,
      },
      reason: input.reason,
    });
    return after;
  });
}

export async function resolveFinding(
  user: SessionUser,
  findingId: string,
  input: { resolution: "RESOLVED" | "DISMISSED_FALSE_POSITIVE"; reason: string },
) {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    include: { instrument: true },
  });
  if (!finding) throw notFound();
  if (!["OPEN", "CORRECTION_REQUESTED"].includes(finding.resolutionStatus)) {
    throw conflict("INVALID_TRANSITION", "This finding is already closed.");
  }

  const critical = finding.severity === "CRITICAL";
  if (critical) {
    if (user.role !== ROLE.COMPETENT_AUTHORITY) {
      throw forbidden("finding", findingId);
    }
  } else if (user.role !== ROLE.SCRUTINY_OFFICER) {
    throw forbidden("finding", findingId);
  }

  const nextStatus = critical ? "OVERRIDDEN" : input.resolution;

  return auditTransaction(async (tx) => {
    await tx.finding.update({
      where: { id: findingId },
      data: {
        resolutionStatus: nextStatus,
        resolutionReason: input.reason,
        resolvedBy: user.id,
        resolvedAt: new Date(),
      },
    });
    const remaining = await tx.finding.count({
      where: {
        instrumentId: finding.instrumentId,
        severity: { in: ["CRITICAL", "HIGH"] },
        resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] },
      },
    });
    const activeRules = await tx.ruleVersion.count({ where: { status: "ACTIVE" } });
    const complianceStatus =
      remaining > 0
        ? COMPLIANCE.FINDINGS_OPEN
        : activeRules === 0
          ? COMPLIANCE.RULES_PENDING
          : COMPLIANCE.NO_KNOWN_FINDINGS;
    await tx.instrument.update({
      where: { id: finding.instrumentId },
      data: { complianceStatus },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: critical ? "finding.overridden" : "finding.resolved",
      entityType: "finding",
      entityId: findingId,
      before: {
        resolutionStatus: finding.resolutionStatus,
        severity: finding.severity,
        ruleId: finding.ruleId,
      },
      after: {
        resolutionStatus: nextStatus,
        complianceStatus,
        findingPreserved: true,
      },
      reason: input.reason,
    });
    return { status: nextStatus, complianceStatus };
  });
}

export async function pendingCorrectionForUser(user: SessionUser) {
  if (!user.institutionId) return 0;
  return prisma.finding.count({
    where: {
      resolutionStatus: "CORRECTION_REQUESTED",
      instrument: { institutionId: user.institutionId },
    },
  });
}
