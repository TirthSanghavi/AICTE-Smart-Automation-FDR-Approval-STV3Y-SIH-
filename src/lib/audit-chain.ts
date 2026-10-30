import { createHash } from "node:crypto";
import type { AuditEvent } from "@prisma/client";

function parse(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Recomputes the audit hash chain. This detects accidental or naive edits; it
 * cannot prove the absence of a database administrator rewriting and rehashing.
 */
export function verifyAuditChain(events: AuditEvent[]): {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
} {
  let prevHash: string | null = null;
  let previousIndex = 0;
  for (const event of events) {
    if (event.chainIndex !== previousIndex + 1) {
      return { ok: false, checked: events.length, brokenAt: event.chainIndex };
    }
    if (event.prevHash !== prevHash) {
      return { ok: false, checked: events.length, brokenAt: event.chainIndex };
    }
    const payload = JSON.stringify({
      chainIndex: event.chainIndex,
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: parse(event.before),
      after: parse(event.after),
      reason: event.reason,
      requestId: event.requestId,
    });
    const expected: string = createHash("sha256")
      .update(`${prevHash ?? "GENESIS"}|${payload}`)
      .digest("hex");
    if (event.hash !== expected) {
      return { ok: false, checked: events.length, brokenAt: event.chainIndex };
    }
    prevHash = event.hash;
    previousIndex = event.chainIndex;
  }
  return { ok: true, checked: events.length, brokenAt: null };
}
