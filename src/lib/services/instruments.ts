import { prisma } from "../db";
import { appendAudit, auditTransaction, notifyUsers } from "../audit";
import {
  COMPLIANCE,
  DOC_STATUS,
  LIFECYCLE,
  ROLE,
} from "../constants";
import { conflict, forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";
import {
  normalizeBank,
  normalizeFdr,
  validateInstrumentInput,
} from "../validation";
import { instrumentSnapshot, fieldLabel } from "../instrument-meta";
import { evaluateDiscrepancies, type FindingDraft } from "../rules/discrepancy";
import { getToday } from "../demo-clock";
import type { Prisma } from "@prisma/client";

export async function activeRuleCount(): Promise<number> {
  return prisma.ruleVersion.count({ where: { status: "ACTIVE" } });
}

function assertManage(user: SessionUser) {
  if (user.role !== ROLE.INSTITUTION_ADMIN || !user.institutionId) {
    throw forbidden("instrument", "create");
  }
}

export async function createInstrument(
  user: SessionUser,
  body: Record<string, unknown>,
) {
  assertManage(user);
  const { value, errors } = validateInstrumentInput(body);
  if (!value) throw invalid("Check the highlighted fields.", errors);

  const institution = await prisma.institution.findUnique({
    where: { id: user.institutionId! },
  });
  if (!institution) throw notFound();

  return auditTransaction(async (tx) => {
    const instrument = await tx.instrument.create({
      data: {
        institutionId: institution.id,
        bankName: value.bankName,
        normalizedBank: normalizeBank(value.bankName),
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
        createdBy: user.id,
        versionNo: 1,
      },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: instrument.id,
        versionNo: 1,
        snapshot: JSON.stringify(instrumentSnapshot(instrument)),
        changedBy: user.id,
        reason: "Draft created",
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "instrument.created",
      entityType: "instrument",
      entityId: instrument.id,
      after: instrumentSnapshot(instrument),
    });
    return instrument;
  });
}

export async function updateInstrument(
  user: SessionUser,
  id: string,
  body: Record<string, unknown>,
) {
  assertManage(user);
  const before = await prisma.instrument.findFirst({
    where: { id, institutionId: user.institutionId! },
  });
  if (!before) throw notFound();
  if (![LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED].includes(before.lifecycleStatus as never)) {
    throw conflict(
      "INVALID_TRANSITION",
      "Only draft or correction records can be edited. Submit a new document version instead.",
    );
  }
  const expectedVersion = Number(body.expectedVersion ?? before.versionNo);
  if (expectedVersion !== before.versionNo) {
    throw conflict("VERSION_CONFLICT", "This record changed since you opened it. Reload and try again.");
  }

  const merged = {
    bankName: body.bankName ?? before.bankName,
    branch: body.branch ?? before.branch,
    fdrNumber: body.fdrNumber ?? before.fdrNumber,
    ifscCode: body.ifscCode ?? before.ifscCode ?? "",
    amount: body.amount ?? before.amount.toString(),
    issueDate: body.issueDate ?? before.issueDate.toISOString().slice(0, 10),
    maturityDate: body.maturityDate ?? before.maturityDate.toISOString().slice(0, 10),
    holderName: body.holderName ?? before.holderName,
    declaredLienStatus: body.declaredLienStatus ?? before.declaredLienStatus,
  };
  const { value, errors } = validateInstrumentInput(merged);
  if (!value) throw invalid("Check the highlighted fields.", errors);

  return auditTransaction(async (tx) => {
    const result = await tx.instrument.updateMany({
      where: { id, versionNo: expectedVersion },
      data: {
        bankName: value.bankName,
        normalizedBank: normalizeBank(value.bankName),
        branch: value.branch,
        fdrNumber: value.fdrNumber,
        normalizedFdr: normalizeFdr(value.fdrNumber),
        ifscCode: value.ifscCode,
        amount: value.amount,
        issueDate: value.issueDate,
        maturityDate: value.maturityDate,
        holderName: value.holderName,
        declaredLienStatus: value.declaredLienStatus,
        versionNo: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw conflict("VERSION_CONFLICT", "This record changed since you opened it. Reload and try again.");
    }
    const after = await tx.instrument.findUniqueOrThrow({ where: { id } });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: id,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: "Draft edited",
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "instrument.updated",
      entityType: "instrument",
      entityId: id,
      before: instrumentSnapshot(before),
      after: instrumentSnapshot(after),
    });
    return after;
  });
}

async function collectFindingDrafts(
  instrument: Prisma.InstrumentGetPayload<{ include: { institution: true } }>,
  docs: { docStatus: string }[],
  today: Date,
): Promise<FindingDraft[]> {
  const latestDocument = docs[0];
  const latestRun = latestDocument
    ? await prisma.extractionRun.findFirst({
        where: { documentId: (latestDocument as { id?: string }).id },
        orderBy: { startedAt: "desc" },
        include: { fields: true },
      })
    : null;

  const duplicates = await prisma.instrument.findMany({
    where: {
      normalizedBank: instrument.normalizedBank,
      normalizedFdr: instrument.normalizedFdr,
      id: { not: instrument.id },
      archivedAt: null,
    },
    include: { institution: true },
  });

  const conflicting = await prisma.verificationAttempt.findFirst({
    where: {
      instrumentId: instrument.id,
      status: "BANK_NOT_CONFIRMED",
      simulated: false,
    },
    orderBy: { createdAt: "desc" },
  });

  return evaluateDiscrepancies({
    instrument: {
      id: instrument.id,
      bankName: instrument.bankName,
      fdrNumber: instrument.fdrNumber,
      amount: Number(instrument.amount.toString()),
      issueDate: instrument.issueDate,
      maturityDate: instrument.maturityDate,
      holderName: instrument.holderName,
      declaredLienStatus: instrument.declaredLienStatus,
    },
    institutionName: instrument.institution.name,
    today,
    duplicates: duplicates.map((d) => ({
      id: d.id,
      fdrNumber: d.fdrNumber,
      bankName: d.bankName,
      institutionName: d.institution.name,
    })),
    extractionDiffs:
      latestRun?.fields
        .filter((f) => f.confirmedValue !== null && f.confirmedValue !== f.value)
        .map((f) => ({
          field: f.name,
          extracted: f.value,
          confirmed: f.confirmedValue ?? "",
        })) ?? [],
    lowConfidence:
      latestRun?.fields
        .filter((f) => f.confidence < 0.7)
        .map((f) => ({ field: f.name, value: f.value, confidence: f.confidence })) ?? [],
    conflictingVerification: conflicting
      ? { sourceName: conflicting.sourceName, status: conflicting.status }
      : null,
    labelForField: fieldLabel,
  });
}

export async function submitInstrument(user: SessionUser, id: string) {
  assertManage(user);
  const instrument = await prisma.instrument.findFirst({
    where: { id, institutionId: user.institutionId! },
    include: { institution: true, documents: { orderBy: { versionNo: "desc" } } },
  });
  if (!instrument) throw notFound();
  if (
    ![
      LIFECYCLE.DRAFT,
      LIFECYCLE.CORRECTION_REQUESTED,
    ].includes(instrument.lifecycleStatus as never)
  ) {
    throw conflict(
      "INVALID_TRANSITION",
      "This record is not in a state that can be submitted.",
    );
  }

  const { value, errors } = validateInstrumentInput({
    bankName: instrument.bankName,
    branch: instrument.branch,
    fdrNumber: instrument.fdrNumber,
    ifscCode: instrument.ifscCode ?? "",
    amount: instrument.amount.toString(),
    issueDate: instrument.issueDate.toISOString().slice(0, 10),
    maturityDate: instrument.maturityDate.toISOString().slice(0, 10),
    holderName: instrument.holderName,
    declaredLienStatus: instrument.declaredLienStatus,
  });
  if (!value) throw invalid("Correct these fields before submitting.", errors);

  const latestDocument = instrument.documents[0];
  if (!latestDocument) {
    throw invalid("Upload the FDR document before submitting.", [
      { field: "document", issue: "At least one document version is required." },
    ]);
  }
  if (latestDocument.docStatus !== DOC_STATUS.CONFIRMED) {
    throw invalid("Review the extracted fields before submitting.", [
      {
        field: "documentStatus",
        issue: "Confirm the extracted fields (or enter them manually) first.",
      },
    ]);
  }

  const today = await getToday();
  const drafts = await collectFindingDrafts(instrument, instrument.documents, today);
  const activeRules = await activeRuleCount();
  const blocking = drafts.some(
    (f) => f.severity === "CRITICAL" || f.severity === "HIGH",
  );
  const complianceStatus = blocking
    ? COMPLIANCE.FINDINGS_OPEN
    : activeRules === 0
      ? COMPLIANCE.RULES_PENDING
      : COMPLIANCE.NO_KNOWN_FINDINGS;

  return auditTransaction(async (tx) => {
    await tx.finding.updateMany({
      where: {
        instrumentId: id,
        resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] },
      },
      data: {
        resolutionStatus: "SUPERSEDED",
        resolutionReason: "Re-evaluated on resubmission.",
        resolvedAt: new Date(),
      },
    });
    if (drafts.length > 0) {
      await tx.finding.createMany({
        data: drafts.map((draft) => ({
          instrumentId: id,
          ruleId: draft.ruleId,
          field: draft.field,
          observed: draft.observed,
          expected: draft.expected,
          basis: draft.basis,
          severity: draft.severity,
          explanation: draft.explanation,
          recommendedAction: draft.recommendedAction,
        })),
      });
    }
    const after = await tx.instrument.update({
      where: { id },
      data: {
        lifecycleStatus: LIFECYCLE.SUBMITTED,
        complianceStatus,
        versionNo: { increment: 1 },
      },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: id,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason:
          instrument.lifecycleStatus === LIFECYCLE.CORRECTION_REQUESTED
            ? "Corrected version submitted"
            : "Submitted for scrutiny",
      },
    });
    const officers = await tx.user.findMany({
      where: { role: ROLE.SCRUTINY_OFFICER, status: "ACTIVE" },
      select: { id: true },
    });
    await notifyUsers(tx, officers.map((u) => u.id), {
      type: "INSTRUMENT_SUBMITTED",
      title: "New instrument submitted for scrutiny",
      body: `${instrument.institution.name} submitted ${instrument.fdrNumber}. ${drafts.length} finding(s) were generated.`,
      dedupeKey: `instrument-submitted:${id}:${after.versionNo}`,
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action:
        instrument.lifecycleStatus === LIFECYCLE.CORRECTION_REQUESTED
          ? "instrument.resubmitted"
          : "instrument.submitted",
      entityType: "instrument",
      entityId: id,
      before: instrumentSnapshot(instrument),
      after: { ...instrumentSnapshot(after), findingsGenerated: drafts.length },
    });
    return { instrument: after, findings: drafts };
  });
}

export async function claimInstrument(user: SessionUser, id: string) {
  if (user.role !== ROLE.SCRUTINY_OFFICER) throw forbidden("instrument", id);
  const before = await prisma.instrument.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (before.lifecycleStatus !== LIFECYCLE.SUBMITTED) {
    throw conflict("INVALID_TRANSITION", "Only a submitted record can be taken into review.");
  }
  return auditTransaction(async (tx) => {
    const after = await tx.instrument.update({
      where: { id },
      data: { lifecycleStatus: LIFECYCLE.UNDER_REVIEW, versionNo: { increment: 1 } },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: id,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: "Taken into scrutiny",
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "instrument.review_started",
      entityType: "instrument",
      entityId: id,
      before: instrumentSnapshot(before),
      after: instrumentSnapshot(after),
    });
    return after;
  });
}
