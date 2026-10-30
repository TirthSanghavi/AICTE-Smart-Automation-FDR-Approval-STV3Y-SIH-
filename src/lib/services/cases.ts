import { prisma } from "../db";
import { appendAudit, auditTransaction, notifyUsers } from "../audit";
import {
  CASE_DISCLAIMER,
  CASE_OPEN_STATUSES,
  CASE_TYPE,
  LIFECYCLE,
  ROLE,
} from "../constants";
import { conflict, forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";
import {
  CHECKLIST_LABEL,
  CHECKLIST_VERSION,
  checklistFor,
  checklistSatisfied,
} from "../rules/checklist";
import { countOpenBlocking } from "../rules/discrepancy";
import { instrumentSnapshot } from "../instrument-meta";

export async function createCase(
  user: SessionUser,
  instrumentId: string,
  input: { type: string; reason: string },
) {
  if (user.role !== ROLE.INSTITUTION_ADMIN || !user.institutionId) {
    throw forbidden("instrument", instrumentId);
  }
  if (!Object.values(CASE_TYPE).includes(input.type as never)) {
    throw invalid("Choose a valid case type.");
  }
  const instrument = await prisma.instrument.findFirst({
    where: { id: instrumentId, institutionId: user.institutionId },
    include: { institution: true },
  });
  if (!instrument) throw notFound();
  if (
    [LIFECYCLE.DRAFT, LIFECYCLE.CLOSED, LIFECYCLE.ARCHIVED, LIFECYCLE.REPLACED].includes(
      instrument.lifecycleStatus as never,
    )
  ) {
    throw conflict(
      "INVALID_INSTRUMENT_STATE",
      "A case can only be opened for a submitted, active or disputed record.",
    );
  }

  const tasks = checklistFor(input.type);
  return auditTransaction(async (tx) => {
    const existing = await tx.releaseCase.count({
      where: {
        instrumentId,
        type: input.type,
        status: { in: CASE_OPEN_STATUSES },
      },
    });
    if (existing > 0) {
      throw conflict(
        "DUPLICATE_OPEN_CASE",
        "An open case of this type already exists for this instrument.",
      );
    }

    const releaseCase = await tx.releaseCase.create({
      data: {
        instrumentId,
        institutionId: instrument.institutionId,
        type: input.type,
        reason: input.reason,
        status: "OPEN",
        templateVersion: CHECKLIST_VERSION,
        templateLabel: CHECKLIST_LABEL,
        createdBy: user.id,
        tasks: {
          create: tasks.map((task) => ({
            stepOrder: task.stepOrder,
            role: task.role,
            title: task.title,
            description: task.description,
            required: task.required,
          })),
        },
      },
      include: { tasks: true },
    });

    const officers = await tx.user.findMany({
      where: { role: ROLE.SCRUTINY_OFFICER, status: "ACTIVE" },
      select: { id: true },
    });
    await notifyUsers(tx, officers.map((o) => o.id), {
      type: "CASE_OPENED",
      title: "New release case opened",
      body: `${instrument.institution.name} opened a ${input.type.toLowerCase()} case for ${instrument.fdrNumber}.`,
      dedupeKey: `case-opened:${releaseCase.id}`,
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "case.opened",
      entityType: "release_case",
      entityId: releaseCase.id,
      after: {
        instrumentId,
        type: input.type,
        templateVersion: CHECKLIST_VERSION,
        templateLabel: CHECKLIST_LABEL,
        checklistTasks: tasks.map((t) => t.title),
        instrumentLifecycleUnchanged: instrument.lifecycleStatus,
      },
      reason: input.reason,
    });
    return releaseCase;
  });
}

export async function completeTask(
  user: SessionUser,
  caseId: string,
  taskId: string,
  input: { outcome: "SATISFIED" | "NOT_SATISFIED"; notes: string },
) {
  const releaseCase = await prisma.releaseCase.findUnique({
    where: { id: caseId },
    include: { tasks: { orderBy: { stepOrder: "asc" } }, instrument: true },
  });
  if (!releaseCase) throw notFound();
  const task = releaseCase.tasks.find((t) => t.id === taskId);
  if (!task) throw notFound();
  if (task.role !== user.role) {
    throw forbidden("review_task", taskId);
  }
  if (
    (user.role === ROLE.INSTITUTION_ADMIN || user.role === ROLE.INSTITUTION_VIEWER) &&
    releaseCase.institutionId !== user.institutionId
  ) {
    throw forbidden("review_task", taskId);
  }
  if (!CASE_OPEN_STATUSES.includes(releaseCase.status as never)) {
    throw conflict("INVALID_TRANSITION", "This case is closed to further task updates.");
  }
  if (task.status === "COMPLETED") {
    throw conflict("TASK_ALREADY_COMPLETED", "This checklist item is already completed.");
  }

  return auditTransaction(async (tx) => {
    const updated = await tx.reviewTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        outcome: input.outcome,
        notes: input.notes,
        completedBy: user.id,
        completedAt: new Date(),
      },
    });
    await tx.releaseCase.update({
      where: { id: caseId },
      data: { status: "IN_REVIEW" },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "task.completed",
      entityType: "review_task",
      entityId: taskId,
      before: { status: task.status },
      after: {
        status: "COMPLETED",
        outcome: input.outcome,
        caseId,
        instrumentLifecycleUnchanged: releaseCase.instrument.lifecycleStatus,
      },
      reason: input.notes,
    });
    return updated;
  });
}

export async function recordClearance(
  user: SessionUser,
  caseId: string,
  input: {
    kind: string;
    issuer: string;
    reference: string;
    issuedOn: Date;
    scope: string;
  },
) {
  const clearanceRoles: string[] = [ROLE.DEPT_REVIEWER, ROLE.SCRUTINY_OFFICER];
  if (!clearanceRoles.includes(user.role)) {
    throw forbidden("release_case", caseId);
  }
  const releaseCase = await prisma.releaseCase.findUnique({
    where: { id: caseId },
  });
  if (!releaseCase) throw notFound();
  if (!CASE_OPEN_STATUSES.includes(releaseCase.status as never)) {
    throw conflict("INVALID_TRANSITION", "This case is closed to new clearances.");
  }

  return auditTransaction(async (tx) => {
    const clearance = await tx.clearanceNoc.create({
      data: {
        caseId,
        kind: input.kind,
        issuer: input.issuer,
        reference: input.reference,
        issuedOn: input.issuedOn,
        scope: input.scope,
        verifiedBy: user.id,
        verifiedAt: new Date(),
      },
    });
    await tx.releaseCase.update({
      where: { id: caseId },
      data: { status: "IN_REVIEW" },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "noc.recorded",
      entityType: "clearance_noc",
      entityId: clearance.id,
      after: {
        caseId,
        kind: input.kind,
        issuer: input.issuer,
        reference: input.reference,
        scope: input.scope,
        note: "Reviewer-recorded; not independently verified with the issuer.",
      },
    });
    return clearance;
  });
}

export async function decideCase(
  user: SessionUser,
  caseId: string,
  input: { outcome: string; reason: string },
) {
  if (user.role !== ROLE.COMPETENT_AUTHORITY) {
    throw forbidden("release_case", caseId);
  }
  const allowed = ["APPROVED", "REJECTED", "RETURNED", "ESCALATED"];
  if (!allowed.includes(input.outcome)) {
    throw invalid("Choose a valid decision outcome.");
  }
  if (input.reason.trim().length < 10) {
    throw invalid("Record a decision reason of at least 10 characters.", [
      { field: "reason", issue: "A meaningful reason is required for audit." },
    ]);
  }

  const releaseCase = await prisma.releaseCase.findUnique({
    where: { id: caseId },
    include: {
      tasks: { orderBy: { stepOrder: "asc" } },
      instrument: { include: { findings: true } },
    },
  });
  if (!releaseCase) throw notFound();
  if (!CASE_OPEN_STATUSES.includes(releaseCase.status as never)) {
    throw conflict("INVALID_TRANSITION", "This case already has a final status.");
  }
  if (releaseCase.createdBy === user.id) {
    throw forbidden("release_case", caseId);
  }
  if (releaseCase.tasks.some((task) => task.completedBy === user.id)) {
    throw forbidden("release_case", caseId);
  }

  if (input.outcome === "APPROVED") {
    const { complete } = checklistSatisfied(releaseCase.tasks);
    if (!complete) {
      const missing = releaseCase.tasks
        .filter(
          (task) =>
            task.required &&
            !(task.status === "COMPLETED" && task.outcome === "SATISFIED"),
        )
        .map((task) => task.title);
      throw conflict(
        "CHECKLIST_INCOMPLETE",
        "The case cannot be approved until all required checklist items are complete and satisfied.",
        missing.map((title) => ({ field: "checklist", issue: title })),
      );
    }
    if (countOpenBlocking(releaseCase.instrument.findings) > 0) {
      throw conflict(
        "FINDINGS_BLOCKING_DECISION",
        "Open critical findings must be resolved or formally overridden before approval.",
      );
    }
  }

  return auditTransaction(async (tx) => {
    const decision = await tx.decision.create({
      data: {
        caseId,
        outcome: input.outcome,
        reason: input.reason,
        authorityUserId: user.id,
        checklistSnapshot: JSON.stringify(
          releaseCase.tasks.map((task) => ({
            title: task.title,
            role: task.role,
            required: task.required,
            status: task.status,
            outcome: task.outcome,
            completedBy: task.completedBy,
          })),
        ),
      },
    });
    await tx.releaseCase.update({
      where: { id: caseId },
      data: { status: input.outcome },
    });
    const admins = await tx.user.findMany({
      where: {
        institutionId: releaseCase.institutionId,
        role: ROLE.INSTITUTION_ADMIN,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    await notifyUsers(tx, admins.map((a) => a.id), {
      type: "CASE_DECIDED",
      title: `Case ${input.outcome.toLowerCase()}`,
      body: `${releaseCase.type} case for ${releaseCase.instrument.fdrNumber}: ${input.outcome}. ${CASE_DISCLAIMER}`,
      dedupeKey: `case-decided:${decision.id}`,
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "decision.recorded",
      entityType: "decision",
      entityId: decision.id,
      before: { caseStatus: releaseCase.status },
      after: {
        caseId,
        outcome: input.outcome,
        checklistSnapshotVersion: releaseCase.templateVersion,
        instrumentLifecycleUnchanged: releaseCase.instrument.lifecycleStatus,
        disclaimer: CASE_DISCLAIMER,
      },
      reason: input.reason,
    });
    return decision;
  });
}

export async function withdrawCase(user: SessionUser, caseId: string) {
  if (user.role !== ROLE.INSTITUTION_ADMIN) throw forbidden("release_case", caseId);
  const releaseCase = await prisma.releaseCase.findUnique({
    where: { id: caseId },
    include: { instrument: true },
  });
  if (!releaseCase) throw notFound();
  if (releaseCase.institutionId !== user.institutionId) {
    throw forbidden("release_case", caseId);
  }
  if (!CASE_OPEN_STATUSES.includes(releaseCase.status as never)) {
    throw conflict("INVALID_TRANSITION", "Only an open case can be withdrawn.");
  }

  return auditTransaction(async (tx) => {
    const updated = await tx.releaseCase.update({
      where: { id: caseId },
      data: { status: "WITHDRAWN" },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "case.withdrawn",
      entityType: "release_case",
      entityId: caseId,
      before: { status: releaseCase.status },
      after: {
        status: "WITHDRAWN",
        instrumentLifecycleUnchanged: releaseCase.instrument.lifecycleStatus,
      },
    });
    return updated;
  });
}

export async function closeInstrument(
  user: SessionUser,
  instrumentId: string,
  reason: string,
) {
  if (user.role !== ROLE.COMPETENT_AUTHORITY) {
    throw forbidden("instrument", instrumentId);
  }
  if (reason.trim().length < 10) {
    throw invalid("Record a closure reason of at least 10 characters.");
  }
  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    include: { releaseCases: true, findings: true },
  });
  if (!instrument) throw notFound();
  const approved = instrument.releaseCases.some((c) => c.status === "APPROVED");
  if (!approved) {
    throw conflict(
      "NO_APPROVED_CASE",
      "An approved release case is required before the instrument can be closed.",
    );
  }
  if (countOpenBlocking(instrument.findings) > 0) {
    throw conflict(
      "FINDINGS_BLOCKING_CLOSURE",
      "Resolve open critical findings before closing the instrument.",
    );
  }
  if ([LIFECYCLE.CLOSED, LIFECYCLE.ARCHIVED].includes(instrument.lifecycleStatus as never)) {
    throw conflict("INVALID_TRANSITION", "This instrument is already closed.");
  }

  return auditTransaction(async (tx) => {
    const after = await tx.instrument.update({
      where: { id: instrumentId },
      data: { lifecycleStatus: LIFECYCLE.CLOSED, versionNo: { increment: 1 } },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: "Administrative closure recorded; bank instruction external",
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "instrument.closed",
      entityType: "instrument",
      entityId: instrumentId,
      before: instrumentSnapshot(instrument),
      after: {
        ...instrumentSnapshot(after),
        note: "Portal closure is an administrative record only. No bank instruction was sent and no funds moved.",
      },
      reason,
    });
    return after;
  });
}
