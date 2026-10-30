import type { Instrument } from "@prisma/client";
import { prisma } from "../db";
import { appendAudit, auditTransaction } from "../audit";
import { DOC_STATUS, LIFECYCLE, ROLE } from "../constants";
import { conflict, forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";
import { getOcrAdapter, OcrUnavailableError } from "../adapters/ocr";
import { instrumentSnapshot, ALL_CONFIRMATION_FIELDS } from "../instrument-meta";
import { validateInstrumentInput } from "../validation";
import { recordExtractionAudit } from "./documents";

function assertOwner(user: SessionUser, instrument: Instrument) {
  if (user.role !== ROLE.INSTITUTION_ADMIN || user.institutionId !== instrument.institutionId) {
    throw forbidden("instrument", instrument.id);
  }
}

export async function runExtraction(user: SessionUser, documentId: string) {
  const document = await prisma.documentVersion.findUnique({
    where: { id: documentId },
    include: { instrument: true },
  });
  if (!document) throw notFound();
  assertOwner(user, document.instrument);

  if (![LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED].includes(document.instrument.lifecycleStatus as never)) {
    throw conflict("INVALID_TRANSITION", "Extraction is only available on an editable record.");
  }

  const existing = await prisma.extractionRun.findFirst({
    where: { documentId, status: "EXTRACTED" },
    include: { fields: true },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return { run: existing, reused: true as const };

  const adapter = getOcrAdapter();
  try {
    const result = await adapter.extract({
      fileName: document.originalName,
      instrument: document.instrument,
    });
    return await auditTransaction(async (tx) => {
      const run = await tx.extractionRun.create({
        data: {
          documentId,
          adapter: result.adapter,
          status: "EXTRACTED",
          simulated: true,
          finishedAt: new Date(),
          fields: {
            create: result.fields.map((field) => ({
              instrumentId: document.instrumentId,
              name: field.name,
              value: field.value,
              confidence: field.confidence,
              provenance: "OCR",
            })),
          },
        },
        include: { fields: true },
      });
      await tx.documentVersion.update({
        where: { id: documentId },
        data: { docStatus: DOC_STATUS.EXTRACTED },
      });
      await tx.instrument.update({
        where: { id: document.instrumentId },
        data: { documentStatus: DOC_STATUS.EXTRACTED, versionNo: { increment: 1 } },
      });
      await recordExtractionAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        documentId,
        instrumentId: document.instrumentId,
        status: "EXTRACTED",
        adapter: result.adapter,
        fieldCount: result.fields.length,
      });
      return { run, reused: false as const };
    });
  } catch (error) {
    if (!(error instanceof OcrUnavailableError)) throw error;

    const run = await auditTransaction(async (tx) => {
      const failed = await tx.extractionRun.create({
        data: {
          documentId,
          adapter: adapter.adapter,
          status: "EXTRACTION_FAILED",
          simulated: true,
          error: error.message,
          finishedAt: new Date(),
        },
        include: { fields: true },
      });
      await tx.documentVersion.update({
        where: { id: documentId },
        data: { docStatus: DOC_STATUS.EXTRACTION_FAILED },
      });
      await tx.instrument.update({
        where: { id: document.instrumentId },
        data: {
          documentStatus: DOC_STATUS.EXTRACTION_FAILED,
          versionNo: { increment: 1 },
        },
      });
      await recordExtractionAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        documentId,
        instrumentId: document.instrumentId,
        status: "EXTRACTION_FAILED",
        adapter: adapter.adapter,
        fieldCount: 0,
        error: error.message,
      });
      return failed;
    });
    // No instrument verification status is touched on extraction failure.
    return { run, reused: false as const };
  }
}

function provenanceFor(extracted: string | null, confirmed: string): "OCR" | "USER" {
  if (extracted === null) return "USER";
  return extracted.trim() === confirmed.trim() ? "OCR" : "USER";
}

export async function confirmFields(
  user: SessionUser,
  runId: string,
  values: Record<string, unknown>,
) {
  const run = await prisma.extractionRun.findUnique({
    where: { id: runId },
    include: {
      fields: true,
      document: { include: { instrument: { include: { institution: true } } } },
    },
  });
  if (!run) throw notFound();
  const instrument = run.document.instrument;
  assertOwner(user, instrument);
  if (run.status !== "EXTRACTED") {
    throw conflict("EXTRACTION_NOT_READY", "Extraction did not complete; use manual entry.");
  }

  const { value, errors } = validateInstrumentInput({
    ...values,
    bankName: values.bankName ?? instrument.bankName,
    branch: values.branch ?? instrument.branch,
    fdrNumber: values.fdrNumber ?? instrument.fdrNumber,
    amount: values.amount ?? instrument.amount.toString(),
    issueDate: values.issueDate ?? instrument.issueDate.toISOString().slice(0, 10),
    maturityDate: values.maturityDate ?? instrument.maturityDate.toISOString().slice(0, 10),
    holderName: values.holderName ?? instrument.holderName,
    declaredLienStatus: values.declaredLienStatus ?? instrument.declaredLienStatus,
  });
  if (!value) throw invalid("Check the confirmed values.", errors);

  return applyConfirmedValues({
    user,
    instrument,
    documentId: run.documentId,
    runId,
    values: value,
    existingFields: run.fields,
    reason: "Extracted fields reviewed and confirmed",
    auditAction: "fields.confirmed",
    simulated: true,
  });
}

export async function enterFieldsManually(
  user: SessionUser,
  instrumentId: string,
  values: Record<string, unknown>,
) {
  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    include: {
      institution: true,
      documents: { orderBy: { versionNo: "desc" } },
    },
  });
  if (!instrument) throw notFound();
  assertOwner(user, instrument);
  if (![LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED].includes(instrument.lifecycleStatus as never)) {
    throw conflict("INVALID_TRANSITION", "Manual entry is only available on an editable record.");
  }
  const document = instrument.documents[0];
  if (!document) throw invalid("Upload a document before entering fields.", [
    { field: "document", issue: "A document is required." },
  ]);
  if (document.docStatus === DOC_STATUS.CONFIRMED || document.docStatus === DOC_STATUS.EXTRACTED) {
    throw conflict(
      "USE_FIELD_REVIEW",
      "This document already has extracted values. Review them instead of entering them manually.",
    );
  }

  const { value, errors } = validateInstrumentInput(values);
  if (!value) throw invalid("Check the entered values.", errors);

  return auditTransaction(async (tx) => {
    const run = await tx.extractionRun.create({
      data: {
        documentId: document.id,
        adapter: "MANUAL_ENTRY",
        status: "EXTRACTED",
        simulated: false,
        finishedAt: new Date(),
        fields: {
          create: ALL_CONFIRMATION_FIELDS.map((name) => ({
            instrumentId,
            name,
            value: String(values[name] ?? ""),
            confidence: 0,
            confirmedValue: String(values[name] ?? ""),
            provenance: "USER",
            confirmedBy: user.id,
            confirmedAt: new Date(),
          })),
        },
      },
      include: { fields: true },
    });

    const after = await tx.instrument.update({
      where: { id: instrumentId },
      data: {
        bankName: value.bankName,
        normalizedBank: value.bankName.toLowerCase().replace(/[^a-z0-9]/g, ""),
        branch: value.branch,
        fdrNumber: value.fdrNumber,
        normalizedFdr: value.fdrNumber.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        amount: value.amount,
        issueDate: value.issueDate,
        maturityDate: value.maturityDate,
        holderName: value.holderName,
        declaredLienStatus: value.declaredLienStatus,
        documentStatus: DOC_STATUS.CONFIRMED,
        versionNo: { increment: 1 },
      },
    });
    await tx.documentVersion.update({
      where: { id: document.id },
      data: { docStatus: DOC_STATUS.CONFIRMED },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: "Fields entered manually after extraction failure",
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "fields.manual_entry",
      entityType: "instrument",
      entityId: instrumentId,
      before: instrumentSnapshot(instrument),
      after: { ...instrumentSnapshot(after), extractionRunId: run.id },
      reason: "Manual entry path used; OCR output, if any, was not treated as verification.",
    });
    return { run, instrument: after };
  });
}

async function applyConfirmedValues(input: {
  user: SessionUser;
  instrument: Instrument;
  documentId: string;
  runId: string;
  values: {
    bankName: string;
    branch: string | null;
    fdrNumber: string;
    amount: number;
    issueDate: Date;
    maturityDate: Date;
    holderName: string;
    declaredLienStatus: "YES" | "NO" | "UNKNOWN";
  };
  existingFields: { id: string; name: string; value: string; confirmedValue: string | null }[];
  reason: string;
  auditAction: string;
  simulated: boolean;
}) {
  const { user, instrument, values } = input;
  const byName = new Map(input.existingFields.map((f) => [f.name, f]));
  const confirmedStrings: Record<string, string> = {
    bankName: values.bankName,
    branch: values.branch ?? "",
    fdrNumber: values.fdrNumber,
    amount: values.amount.toFixed(2),
    issueDate: values.issueDate.toISOString().slice(0, 10),
    maturityDate: values.maturityDate.toISOString().slice(0, 10),
    holderName: values.holderName,
    declaredLienStatus: values.declaredLienStatus,
  };

  return auditTransaction(async (tx) => {
    for (const name of ALL_CONFIRMATION_FIELDS) {
      const confirmed = confirmedStrings[name] ?? "";
      const existing = byName.get(name);
      if (existing) {
        await tx.extractedField.update({
          where: { id: existing.id },
          data: {
            confirmedValue: confirmed,
            provenance: provenanceFor(existing.value, confirmed),
            confirmedBy: user.id,
            confirmedAt: new Date(),
          },
        });
      } else {
        await tx.extractedField.create({
          data: {
            runId: input.runId,
            instrumentId: instrument.id,
            name,
            value: confirmed,
            confidence: 0,
            confirmedValue: confirmed,
            provenance: "USER",
            confirmedBy: user.id,
            confirmedAt: new Date(),
          },
        });
      }
    }

    const after = await tx.instrument.update({
      where: { id: instrument.id },
      data: {
        bankName: values.bankName,
        normalizedBank: values.bankName.toLowerCase().replace(/[^a-z0-9]/g, ""),
        branch: values.branch,
        fdrNumber: values.fdrNumber,
        normalizedFdr: values.fdrNumber.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        amount: values.amount,
        issueDate: values.issueDate,
        maturityDate: values.maturityDate,
        holderName: values.holderName,
        declaredLienStatus: values.declaredLienStatus,
        documentStatus: DOC_STATUS.CONFIRMED,
        versionNo: { increment: 1 },
      },
    });
    await tx.documentVersion.update({
      where: { id: input.documentId },
      data: { docStatus: DOC_STATUS.CONFIRMED },
    });
    await tx.instrumentHistory.create({
      data: {
        instrumentId: instrument.id,
        versionNo: after.versionNo,
        snapshot: JSON.stringify(instrumentSnapshot(after)),
        changedBy: user.id,
        reason: input.reason,
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: input.auditAction,
      entityType: "instrument",
      entityId: instrument.id,
      before: instrumentSnapshot(instrument),
      after: {
        ...instrumentSnapshot(after),
        extractionRunId: input.runId,
        simulatedExtraction: input.simulated,
        provenance: Object.fromEntries(
          ALL_CONFIRMATION_FIELDS.map((name) => [
            name,
            provenanceFor(byName.get(name)?.value ?? null, confirmedStrings[name] ?? ""),
          ]),
        ),
      },
    });
    return { instrument: after };
  });
}
