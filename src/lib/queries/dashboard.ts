import { prisma } from "../db";
import type { SessionUser } from "../auth";
import { CASE_OPEN_STATUSES, LIFECYCLE, ROLE } from "../constants";
import { addDays } from "../dates";
import { getToday } from "../demo-clock";

export async function institutionOverview(user: SessionUser) {
  const institutionId = user.institutionId ?? "__none__";
  const today = await getToday();
  const soon = addDays(today, 90);
  const openStatuses = ["OPEN", "CORRECTION_REQUESTED"];

  const [
    total,
    active,
    maturingCount,
    overdueCount,
    correctionCount,
    openCases,
    principal,
    instruments,
    alerts,
    notifications,
    criticalFindings,
  ] = await Promise.all([
    prisma.instrument.count({ where: { institutionId } }),
    prisma.instrument.count({ where: { institutionId, lifecycleStatus: LIFECYCLE.ACTIVE } }),
    prisma.instrument.count({
      where: {
        institutionId,
        lifecycleStatus: LIFECYCLE.ACTIVE,
        maturityDate: { gte: today, lte: soon },
      },
    }),
    prisma.instrument.count({
      where: {
        institutionId,
        lifecycleStatus: LIFECYCLE.ACTIVE,
        maturityDate: { lt: today },
      },
    }),
    prisma.finding.count({
      where: {
        resolutionStatus: { in: openStatuses },
        instrument: { institutionId },
      },
    }),
    prisma.releaseCase.count({
      where: { institutionId, status: { in: CASE_OPEN_STATUSES } },
    }),
    prisma.instrument.aggregate({
      where: {
        institutionId,
        lifecycleStatus: {
          in: [
            LIFECYCLE.ACTIVE,
            LIFECYCLE.SUBMITTED,
            LIFECYCLE.UNDER_REVIEW,
            LIFECYCLE.CORRECTION_REQUESTED,
            LIFECYCLE.DISPUTED,
          ],
        },
      },
      _sum: { amount: true },
    }),
    prisma.instrument.findMany({
      where: { institutionId },
      orderBy: [{ updatedAt: "desc" }],
      take: 6,
      include: {
        findings: {
          where: { resolutionStatus: { in: openStatuses } },
          select: { id: true, severity: true },
        },
      },
    }),
    prisma.maturityAlert.findMany({
      where: { recipientId: user.id, ackAt: null },
      include: { instrument: true },
      orderBy: { sentAt: "desc" },
      take: 5,
    }),
    prisma.notification.findMany({
      where: { userId: user.id, status: "UNREAD" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.finding.count({
      where: {
        severity: "CRITICAL",
        resolutionStatus: { in: openStatuses },
        instrument: { institutionId },
      },
    }),
  ]);

  return {
    today,
    total,
    active,
    maturingCount,
    overdueCount,
    correctionCount,
    openCases,
    principal: principal._sum.amount,
    instruments,
    alerts,
    notifications,
    criticalFindings,
  };
}

export async function officerOverview(user: SessionUser) {
  const [submitted, underReview, openFindings, criticalOpen, queue, pendingTasks, notifications, resolvedToday] =
    await Promise.all([
      prisma.instrument.count({ where: { lifecycleStatus: LIFECYCLE.SUBMITTED } }),
      prisma.instrument.count({ where: { lifecycleStatus: LIFECYCLE.UNDER_REVIEW } }),
      prisma.finding.count({
        where: { resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
      }),
      prisma.finding.count({
        where: { severity: "CRITICAL", resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
      }),
      prisma.instrument.findMany({
        where: { lifecycleStatus: { in: [LIFECYCLE.SUBMITTED, LIFECYCLE.UNDER_REVIEW] } },
        include: {
          institution: true,
          findings: {
            where: { resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
            select: { severity: true, resolutionStatus: true },
          },
        },
        orderBy: [{ lifecycleStatus: "asc" }, { updatedAt: "asc" }],
        take: 8,
      }),
      prisma.reviewTask.count({
        where: {
          role: ROLE.SCRUTINY_OFFICER,
          status: "PENDING",
          case: { status: { in: CASE_OPEN_STATUSES } },
        },
      }),
      prisma.notification.findMany({
        where: { userId: user.id, status: "UNREAD" },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.finding.count({
        where: {
          resolutionStatus: { in: ["RESOLVED", "DISMISSED_FALSE_POSITIVE", "OVERRIDDEN"] },
          resolvedAt: { gte: addDays(new Date(), -1) },
        },
      }),
    ]);

  return {
    submitted,
    underReview,
    openFindings,
    criticalOpen,
    queue,
    pendingTasks,
    notifications,
    resolvedToday,
  };
}

export async function authorityOverview() {
  const cases = await prisma.releaseCase.findMany({
    where: { status: { in: CASE_OPEN_STATUSES } },
    include: {
      instrument: true,
      institution: true,
      tasks: true,
      decisions: { orderBy: { decidedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  const [criticalOpen, decisions, approvedActive] = await Promise.all([
    prisma.finding.count({
      where: { severity: "CRITICAL", resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
    }),
    prisma.decision.findMany({
      orderBy: { decidedAt: "desc" },
      take: 5,
      include: { case: { include: { instrument: true, institution: true } } },
    }),
    prisma.releaseCase.findMany({
      where: {
        status: "APPROVED",
        instrument: { lifecycleStatus: LIFECYCLE.ACTIVE },
      },
      include: { instrument: true, institution: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);
  const today = await getToday();
  const aging = cases.reduce(
    (acc, item) => {
      const days = Math.floor((Date.now() - item.createdAt.getTime()) / 86_400_000);
      if (days <= 7) acc.underWeek += 1;
      else if (days <= 30) acc.underMonth += 1;
      else acc.overMonth += 1;
      return acc;
    },
    { underWeek: 0, underMonth: 0, overMonth: 0 },
  );

  return { cases, criticalOpen, decisions, approvedActive, today, aging };
}

export async function reviewerOverview(user: SessionUser) {
  const [pending, completed] = await Promise.all([
    prisma.reviewTask.findMany({
      where: {
        role: ROLE.DEPT_REVIEWER,
        status: "PENDING",
        case: { status: { in: CASE_OPEN_STATUSES } },
      },
      include: { case: { include: { instrument: true, institution: true } } },
      orderBy: { case: { createdAt: "asc" } },
      take: 8,
    }),
    prisma.reviewTask.findMany({
      where: { role: ROLE.DEPT_REVIEWER, status: "COMPLETED", completedBy: user.id },
      include: { case: { include: { instrument: true, institution: true } } },
      orderBy: { completedAt: "desc" },
      take: 5,
    }),
  ]);
  return { pending, completed };
}

export async function auditorOverview(user: SessionUser) {
  const [total, denied, overrides, decisions, instruments, recent, actionCounts] =
    await Promise.all([
      prisma.auditEvent.count(),
      prisma.auditEvent.count({ where: { action: "access.denied" } }),
      prisma.auditEvent.count({
        where: { action: { in: ["finding.overridden", "verification.override"] } },
      }),
      prisma.decision.count(),
      prisma.instrument.count(),
      prisma.auditEvent.findMany({
        include: { actor: { select: { name: true, role: true } } },
        orderBy: { chainIndex: "desc" },
        take: 8,
      }),
      prisma.auditEvent.groupBy({
        by: ["action"],
        _count: { _all: true },
        orderBy: { _count: { action: "desc" } },
        take: 6,
      }),
    ]);

  return {
    user,
    total,
    denied,
    overrides,
    decisions,
    instruments,
    recent,
    actionCounts,
  };
}

export async function adminOverview() {
  const [users, pendingRules, activeRules, auditCount, instruments, recent] = await Promise.all([
    prisma.user.count(),
    prisma.ruleVersion.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.ruleVersion.count({ where: { status: "ACTIVE" } }),
    prisma.auditEvent.count(),
    prisma.instrument.count(),
    prisma.auditEvent.findMany({
      include: { actor: { select: { name: true, role: true } } },
      orderBy: { chainIndex: "desc" },
      take: 6,
    }),
  ]);
  return { users, pendingRules, activeRules, auditCount, instruments, recent };
}
