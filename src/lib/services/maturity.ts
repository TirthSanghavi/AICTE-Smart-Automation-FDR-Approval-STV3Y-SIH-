import { prisma } from "../db";
import { appendAudit, auditTransaction, notifyUsers } from "../audit";
import { ALERT_THRESHOLDS, LIFECYCLE, ROLE } from "../constants";
import { daysBetween, formatDate } from "../dates";
import { demoMode, getToday } from "../demo-clock";
import { forbidden, notFound } from "../errors";
import type { SessionUser } from "../auth";

export async function runMaturityScan(user: SessionUser) {
  const scanRoles: string[] = [ROLE.SCRUTINY_OFFICER, ROLE.COMPETENT_AUTHORITY, ROLE.SYSTEM_ADMIN];
  if (!scanRoles.includes(user.role)) {
    throw forbidden("maturity_scan", "all");
  }
  if (!demoMode() && user.role !== ROLE.SYSTEM_ADMIN) {
    throw forbidden("maturity_scan", "all");
  }

  const today = await getToday();
  const instruments = await prisma.instrument.findMany({
    where: { lifecycleStatus: LIFECYCLE.ACTIVE, archivedAt: null },
    include: {
      institution: {
        include: {
          users: {
            where: { role: ROLE.INSTITUTION_ADMIN, status: "ACTIVE" },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { maturityDate: "asc" },
  });

  const candidates: {
    instrumentId: string;
    thresholdDays: number;
    recipientId: string;
    dedupeKey: string;
    message: string;
  }[] = [];

  for (const instrument of instruments) {
    const days = daysBetween(today, instrument.maturityDate);
    const thresholds: number[] = [];
    if (days < 0) {
      thresholds.push(0);
    } else {
      for (const threshold of ALERT_THRESHOLDS) {
        if (days <= threshold) thresholds.push(threshold);
      }
    }
    for (const threshold of thresholds) {
      for (const admin of instrument.institution.users) {
        const dedupeKey = `${instrument.id}:${threshold}:IN_APP:${admin.id}`;
        candidates.push({
          instrumentId: instrument.id,
          thresholdDays: threshold,
          recipientId: admin.id,
          dedupeKey,
          message:
            days < 0
              ? `${instrument.fdrNumber} matured on ${formatDate(instrument.maturityDate)} and is awaiting action.`
              : `${instrument.fdrNumber} matures on ${formatDate(instrument.maturityDate)} (${days} days). Alert threshold: ${threshold} days.`,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { asOf: today, evaluated: instruments.length, created: 0, skipped: 0 };
  }

  const existing = await prisma.maturityAlert.findMany({
    where: { dedupeKey: { in: candidates.map((c) => c.dedupeKey) } },
    select: { dedupeKey: true },
  });
  const existingKeys = new Set(existing.map((e) => e.dedupeKey));
  const fresh = candidates.filter((c) => !existingKeys.has(c.dedupeKey));

  await auditTransaction(async (tx) => {
    for (const candidate of fresh) {
      const alert = await tx.maturityAlert.create({
        data: {
          instrumentId: candidate.instrumentId,
          thresholdDays: candidate.thresholdDays,
          recipientId: candidate.recipientId,
          channel: "IN_APP",
          status: "SENT",
          dedupeKey: candidate.dedupeKey,
        },
      });
      await notifyUsers(tx, [candidate.recipientId], {
        type: "MATURITY_ALERT",
        title: candidate.thresholdDays === 0 ? "FDR matured — action needed" : `${candidate.thresholdDays}-day maturity alert`,
        body: candidate.message,
        dedupeKey: `alert:${alert.id}`,
      });
    }
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "maturity.scan",
      entityType: "maturity_alert",
      entityId: today.toISOString().slice(0, 10),
      after: {
        asOf: today.toISOString().slice(0, 10),
        evaluated: instruments.length,
        created: fresh.length,
        skipped: candidates.length - fresh.length,
      },
      reason: "Deterministic demo maturity scan; in-app channel only.",
    });
  });

  return {
    asOf: today,
    evaluated: instruments.length,
    created: fresh.length,
    skipped: candidates.length - fresh.length,
  };
}

export async function acknowledgeAlert(user: SessionUser, alertId: string) {
  const alert = await prisma.maturityAlert.findUnique({
    where: { id: alertId },
    include: { instrument: true },
  });
  if (!alert) throw notFound();
  if (
    user.institutionId &&
    alert.instrument.institutionId !== user.institutionId
  ) {
    throw forbidden("maturity_alert", alertId);
  }
  const ackRoles: string[] = [ROLE.INSTITUTION_ADMIN, ROLE.INSTITUTION_VIEWER, ROLE.SCRUTINY_OFFICER];
  if (!ackRoles.includes(user.role)) {
    throw forbidden("maturity_alert", alertId);
  }
  if (alert.ackAt) return alert;

  return auditTransaction(async (tx) => {
    const updated = await tx.maturityAlert.update({
      where: { id: alertId },
      data: { status: "ACKNOWLEDGED", ackAt: new Date() },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "alert.acknowledged",
      entityType: "maturity_alert",
      entityId: alertId,
      before: { status: alert.status },
      after: { status: "ACKNOWLEDGED", instrumentId: alert.instrumentId },
    });
    return updated;
  });
}
