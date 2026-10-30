import { prisma } from "../db";
import { appendAudit, auditTransaction } from "../audit";
import { sha256Hex, type TransactionClient } from "../audit";
import { DOC_STATUS, LIFECYCLE, ROLE } from "../constants";
import { conflict, forbidden, notFound } from "../errors";
import type { SessionUser } from "../auth";
import { newStorageKey, readBytes, removeBytes, saveBytes } from "../storage";
import { safeDisplayName, validateUpload } from "../documents";
import { instrumentSnapshot } from "../instrument-meta";

export async function uploadDocument(
  user: SessionUser,
  instrumentId: string,
  file: File,
) {
  if (user.role !== ROLE.INSTITUTION_ADMIN || !user.institutionId) {
    throw forbidden("instrument", instrumentId);
  }
  const instrument = await prisma.instrument.findFirst({
    where: { id: instrumentId, institutionId: user.institutionId },
  });
  if (!instrument) throw notFound();
  if (
    ![LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED].includes(
      instrument.lifecycleStatus as never,
    )
  ) {
    throw conflict(
      "INVALID_TRANSITION",
      "Documents can only be added to a draft or a record where correction was requested.",
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = validateUpload({
    fileName: file.name,
    declaredMime: file.type,
    bytes,
  });
  const storageKey = newStorageKey(detected.extension);
  const digest = sha256Hex(bytes);
  const latest = await prisma.documentVersion.findFirst({
    where: { instrumentId },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true },
  });
  const versionNo = (latest?.versionNo ?? 0) + 1;

  await saveBytes(storageKey, bytes);

  try {
    return await auditTransaction(async (tx) => {
      const document = await tx.documentVersion.create({
        data: {
          instrumentId,
          versionNo,
          originalName: safeDisplayName(file.name),
          storageKey,
          sha256: digest,
          mime: detected.mime,
          size: bytes.length,
          uploadedBy: user.id,
          docStatus: DOC_STATUS.UPLOADED,
        },
      });
      const after = await tx.instrument.update({
        where: { id: instrumentId },
        data: {
          documentStatus: DOC_STATUS.UPLOADED,
          versionNo: { increment: 1 },
        },
      });
      await tx.instrumentHistory.create({
        data: {
          instrumentId,
          versionNo: after.versionNo,
          snapshot: JSON.stringify(instrumentSnapshot(after)),
          changedBy: user.id,
          reason: `Document v${versionNo} uploaded`,
        },
      });
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: "document.uploaded",
        entityType: "document",
        entityId: document.id,
        after: {
          instrumentId,
          versionNo,
          mime: detected.mime,
          size: bytes.length,
          sha256: digest,
        },
      });
      return document;
    });
  } catch (error) {
    await removeBytes(storageKey);
    throw error;
  }
}

export async function getDocumentForUser(user: SessionUser, documentId: string) {
  const document = await prisma.documentVersion.findUnique({
    where: { id: documentId },
    include: { instrument: { include: { releaseCases: { include: { tasks: true } } } } },
  });
  if (!document) throw notFound();

  const instrument = document.instrument;
  if (user.role === ROLE.SERVICE_ACCOUNT) throw forbidden("document", documentId);
  if (user.institutionId && instrument.institutionId !== user.institutionId) {
    throw forbidden("document", documentId);
  }
  if (user.role === ROLE.DEPT_REVIEWER) {
    const assigned = instrument.releaseCases.some((c) =>
      c.tasks.some((t) => t.role === ROLE.DEPT_REVIEWER),
    );
    if (!assigned) throw forbidden("document", documentId);
  }
  if (
    user.role === ROLE.INSTITUTION_ADMIN ||
    user.role === ROLE.INSTITUTION_VIEWER
  ) {
    if (instrument.institutionId !== user.institutionId) {
      throw forbidden("document", documentId);
    }
  }

  let bytes: Buffer;
  try {
    bytes = await readBytes(document.storageKey);
  } catch {
    throw notFound();
  }
  return { document, bytes };
}

export async function recordExtractionAudit(
  tx: TransactionClient,
  input: {
    actorId: string;
    actorRole: string;
    documentId: string;
    instrumentId: string;
    status: string;
    adapter: string;
    fieldCount: number;
    error?: string | null;
  },
) {
  await appendAudit(tx, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: "extraction.run",
    entityType: "document",
    entityId: input.documentId,
    after: {
      instrumentId: input.instrumentId,
      adapter: input.adapter,
      status: input.status,
      fields: input.fieldCount,
      ...(input.error ? { error: input.error } : {}),
    },
  });
}
