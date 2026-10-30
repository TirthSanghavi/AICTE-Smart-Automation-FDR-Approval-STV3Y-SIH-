import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type TransactionClient = Prisma.TransactionClient;

export type AuditInput = {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
};

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * Appends an audit event to the hash chain. Must be called inside the same
 * transaction as the business mutation so neither can commit without the other.
 */
export async function appendAudit(tx: TransactionClient, input: AuditInput) {
  const last = await tx.auditEvent.findFirst({
    orderBy: { chainIndex: "desc" },
    select: { chainIndex: true, hash: true },
  });
  const chainIndex = (last?.chainIndex ?? 0) + 1;
  const prevHash = last?.hash ?? null;
  const payload = JSON.stringify({
    chainIndex,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before === undefined ? null : input.before,
    after: input.after === undefined ? null : input.after,
    reason: input.reason ?? null,
    requestId: input.requestId ?? null,
  });
  const hash = sha256Hex(`${prevHash ?? "GENESIS"}|${payload}`);

  return tx.auditEvent.create({
    data: {
      chainIndex,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: serialize(input.before),
      after: serialize(input.after),
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      prevHash,
      hash,
    },
  });
}

export async function auditTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { timeout?: number },
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: options?.timeout ?? 15_000,
    maxWait: 10_000,
  });
}

export async function recordDeniedAccess(input: {
  actorId: string | null;
  actorRole: string | null;
  entityType: string;
  entityId: string;
  action?: string;
}) {
  await auditTransaction(async (tx) => {
    await appendAudit(tx, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action ?? "access.denied",
      entityType: input.entityType,
      entityId: input.entityId,
      reason: "Server-side authorization denied the request.",
    });
  });
}

export type NotificationInput = {
  type: string;
  title: string;
  body: string;
  dedupeKey: string;
};

export async function notifyUsers(
  tx: TransactionClient,
  userIds: string[],
  notification: NotificationInput,
) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const keys = unique.map((userId) => `${notification.dedupeKey}:${userId}`);
  const existing = await tx.notification.findMany({
    where: { dedupeKey: { in: keys } },
    select: { dedupeKey: true },
  });
  const existingKeys = new Set(existing.map((row) => row.dedupeKey));
  const data = unique
    .map((userId, index) => ({
      userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      dedupeKey: keys[index],
    }))
    .filter((row) => !existingKeys.has(row.dedupeKey));
  if (data.length > 0) await tx.notification.createMany({ data });
}

export async function userIdsForRoles(roles: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: roles }, status: "ACTIVE" },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function institutionAdminIds(institutionId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { institutionId, role: "INSTITUTION_ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
