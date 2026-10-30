import { json, requireApiUser, withApi } from "@/lib/api";
import { verifyAuditChain } from "@/lib/audit-chain";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/constants";

/**
 * FR-024 — hash-chained audit verification job. Recomputes the chain over the
 * whole audit trail and reports the first break. Detects accidental or naive
 * edits; it cannot prove the absence of an administrator who rewrites and
 * rehashes the history.
 */
export async function GET(request: Request) {
  return withApi(request, async () => {
    await requireApiUser([ROLE.AUDITOR, ROLE.SYSTEM_ADMIN]);
    const events = await prisma.auditEvent.findMany({
      orderBy: { chainIndex: "asc" },
    });
    const result = verifyAuditChain(events);
    return json({
      ...result,
      verifiedAt: new Date().toISOString(),
      note: "Recomputed over the full audit trail. A break means the stored history was altered after it was written.",
    });
  });
}
