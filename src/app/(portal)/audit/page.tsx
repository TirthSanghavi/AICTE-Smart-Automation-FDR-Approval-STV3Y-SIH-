import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ROLE, type Role } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { verifyAuditChain } from "@/lib/audit-chain";
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Notice,
  PageHead,
  Stat,
} from "@/components/ui";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string }>;
}) {
  const user = await requireUser();
  const auditRoles: Role[] = [ROLE.AUDITOR, ROLE.SYSTEM_ADMIN];
  if (!auditRoles.includes(user.role)) redirect("/");
  const params = await searchParams;

  const filter: Prisma.AuditEventWhereInput = {};
  if (params.action) filter.action = { contains: params.action.slice(0, 80) };
  if (params.entity) filter.entityType = { contains: params.entity.slice(0, 60) };

  const [all, filtered, denied, overrides] = await Promise.all([
    prisma.auditEvent.findMany({ orderBy: { chainIndex: "asc" }, take: 5000 }),
    prisma.auditEvent.findMany({
      where: filter,
      include: { actor: { select: { name: true, role: true } } },
      orderBy: { chainIndex: "desc" },
      take: 200,
    }),
    prisma.auditEvent.count({ where: { action: "access.denied" } }),
    prisma.auditEvent.count({
      where: { action: { in: ["finding.overridden", "verification.override"] } },
    }),
  ]);
  const chain = verifyAuditChain(all);
  const latest = all[all.length - 1];

  return (
    <>
      <PageHead
        eyebrow="Audit trail"
        title="What changed, who changed it, and why."
        description="Append-only business history with a hash chain. Read-only oversight: no editing or deleting from the interface."
        actions={
          <Link href="/rules" className="btn btn--ghost">
            Source register
          </Link>
        }
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Events in chain" value={all.length} detail="Hash-chained, ascending index" />
          <Stat
            label="Chain status"
            value={chain.ok ? "Verified" : "BROKEN"}
            detail={chain.ok ? "All hashes recomputed" : `Break at index ${chain.brokenAt}`}
            attention={!chain.ok}
          />
          <Stat label="Denied access" value={denied} href="/audit?action=access.denied" detail="Server-side authorization denials" attention={denied > 0} />
          <Stat label="Overrides" value={overrides} href="/audit?action=override" detail="Critical findings and verification" attention={overrides > 0} />
        </div>

        {chain.ok ? (
          <Notice tone="quiet" title="Chain verified">
            Recomputing the chain from the genesis event reproduced every hash. Latest digest{" "}
            <span className="mono">{latest?.hash.slice(0, 20)}…</span>. This detects accidental or
            naive edits; a database administrator could still rewrite and rehash.
          </Notice>
        ) : (
          <Notice tone="danger" title="Chain verification failed">
            The chain does not verify at index {chain.brokenAt}. Treat the audit data as suspect
            and investigate before relying on it.
          </Notice>
        )}

        <form method="get" action="/audit" className="filter-bar">
          <input
            type="text"
            name="action"
            defaultValue={params.action ?? ""}
            placeholder="Filter by action (e.g. decision.recorded)"
            aria-label="Filter by action"
            style={{ maxWidth: 320 }}
          />
          <input
            type="text"
            name="entity"
            defaultValue={params.entity ?? ""}
            placeholder="Entity type (e.g. instrument)"
            aria-label="Filter by entity type"
            style={{ maxWidth: 240 }}
          />
          <button type="submit" className="btn btn--ghost btn--small">Filter</button>
          <Link href="/audit" className="filter-chip">Reset</Link>
          <span className="tiny muted">{filtered.length} shown (max 200)</span>
        </form>

        <Card>
          <CardHead
            title="Event log"
            description="Newest first. Actor, reason, before/after snapshots and hash are retained."
            action={<Badge tone="muted">Append-only</Badge>}
          />
          <CardBody flush>
            {filtered.length === 0 ? (
              <EmptyState
                title="No matching events"
                description="Clear the filters or perform a state-changing action to generate audit evidence."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>When</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Entity</th>
                      <th>Reason</th>
                      <th>Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((event) => (
                      <tr key={event.id}>
                        <td className="mono tiny">{event.chainIndex}</td>
                        <td className="nowrap tiny">{formatDateTime(event.ts)}</td>
                        <td>
                          <span className="mono" style={{ fontSize: 10.5 }}>
                            {event.action}
                          </span>
                        </td>
                        <td>
                          <div>{event.actor?.name ?? "System / unauthenticated"}</div>
                          <div className="data-table__sub">{event.actorRole ?? "—"}</div>
                        </td>
                        <td>
                          <div className="mono" style={{ fontSize: 10 }}>{event.entityType}</div>
                          <div className="data-table__sub" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>
                            {event.entityId}
                          </div>
                        </td>
                        <td style={{ maxWidth: 300 }}>
                          <div className="small">{event.reason ?? "—"}</div>
                          {event.before || event.after ? (
                            <details className="disclosure">
                              <summary>Snapshots</summary>
                              {event.before ? (
                                <>
                                  <div className="tag">Before</div>
                                  <pre className="code-block">{event.before}</pre>
                                </>
                              ) : null}
                              {event.after ? (
                                <>
                                  <div className="tag" style={{ marginTop: 6 }}>After</div>
                                  <pre className="code-block">{event.after}</pre>
                                </>
                              ) : null}
                            </details>
                          ) : null}
                        </td>
                        <td className="mono tiny" style={{ maxWidth: 130, overflowWrap: "anywhere" }}>
                          {event.hash.slice(0, 16)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
          <div className="card__foot">
            <span>
              State changes and their audit event commit in the same database transaction. If the
              audit insert fails, the business change rolls back.
            </span>
            <Link href="/rules" className="tiny mono">Audit limits →</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
