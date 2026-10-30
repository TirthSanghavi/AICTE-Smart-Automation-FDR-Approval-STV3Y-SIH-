import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LIFECYCLE, ROLE, type Role } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { LIFECYCLE_LABEL, VERIFICATION_LABEL } from "@/lib/instrument-meta";
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Notice,
  PageHead,
  Stat,
  StatusBadge,
} from "@/components/ui";

function queueAge(date: Date): string {
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export default async function QueuePage() {
  const user = await requireUser();
  const queueRoles: Role[] = [ROLE.SCRUTINY_OFFICER, ROLE.COMPETENT_AUTHORITY, ROLE.AUDITOR];
  if (!queueRoles.includes(user.role)) {
    redirect("/");
  }

  const [queue, submitted, underReview, correction, criticalOpen] = await Promise.all([
    prisma.instrument.findMany({
      where: {
        lifecycleStatus: {
          in: [
            LIFECYCLE.SUBMITTED,
            LIFECYCLE.UNDER_REVIEW,
            LIFECYCLE.CORRECTION_REQUESTED,
          ],
        },
      },
      include: {
        institution: true,
        findings: {
          where: { resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
        },
        documents: { orderBy: { versionNo: "desc" }, take: 1 },
      },
      orderBy: [{ lifecycleStatus: "asc" }, { updatedAt: "asc" }],
      take: 100,
    }),
    prisma.instrument.count({ where: { lifecycleStatus: LIFECYCLE.SUBMITTED } }),
    prisma.instrument.count({ where: { lifecycleStatus: LIFECYCLE.UNDER_REVIEW } }),
    prisma.instrument.count({ where: { lifecycleStatus: LIFECYCLE.CORRECTION_REQUESTED } }),
    prisma.finding.count({
      where: { severity: "CRITICAL", resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
    }),
  ]);

  return (
    <>
      <PageHead
        eyebrow="Scrutiny queue"
        title="Review the evidence, then record what you actually know."
        description="Submitted, under-review and correction records across all institutions. The queue is sorted oldest-change first so waiting work surfaces."
        actions={<Link href="/instruments" className="btn btn--ghost">All records</Link>}
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Awaiting pickup" value={submitted} detail="SUBMITTED" attention={submitted > 0} />
          <Stat label="Under review" value={underReview} detail="Claimed by scrutiny" />
          <Stat label="Correction requested" value={correction} detail="Waiting on the institution" />
          <Stat label="Critical open" value={criticalOpen} detail="Blocks ordinary verification" attention={criticalOpen > 0} />
        </div>

        <Notice tone="info" title="Queue discipline">
          Taking a record into review is audited. A critical finding cannot be bypassed by an
          ordinary verification; only the competent authority can override it with a reason.
          Duplicate candidates are routed to human review and never auto-rejected.
        </Notice>

        <Card>
          <CardHead
            title="Work in flight"
            description="Open a record for documents, findings and verification. Use the register for a broader search."
            action={<Badge tone="muted">{queue.length} record(s)</Badge>}
          />
          <CardBody flush>
            {queue.length === 0 ? (
              <EmptyState
                title="Queue is clear"
                description="There are no submitted, under-review or correction records right now."
                action={<Link href="/instruments" className="btn btn--ghost">Browse records</Link>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Institution</th>
                      <th>Amount</th>
                      <th>Lifecycle</th>
                      <th>Verification</th>
                      <th>Open findings</th>
                      <th>In queue</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((instrument) => (
                      <tr key={instrument.id}>
                        <td>
                          <Link href={`/instruments/${instrument.id}`} className="data-table__primary mono">
                            {instrument.fdrNumber}
                          </Link>
                          <div className="data-table__sub">
                            {instrument.bankName} · doc v{instrument.documents[0]?.versionNo ?? "—"}
                          </div>
                        </td>
                        <td>
                          <div>{instrument.institution.name}</div>
                          <div className="data-table__sub mono">{instrument.institution.aicteRef}</div>
                        </td>
                        <td className="amount">{formatMoney(instrument.amount)}</td>
                        <td>
                          <StatusBadge
                            value={instrument.lifecycleStatus}
                            label={LIFECYCLE_LABEL[instrument.lifecycleStatus]}
                          />
                        </td>
                        <td>
                          <StatusBadge
                            value={instrument.verificationStatus}
                            label={VERIFICATION_LABEL[instrument.verificationStatus]}
                          />
                        </td>
                        <td>
                          {instrument.findings.length === 0 ? (
                            <span className="tiny muted">None</span>
                          ) : (
                            <div className="badge-row">
                              {instrument.findings.some((f) => f.severity === "CRITICAL") ? (
                                <Badge tone="critical">Critical</Badge>
                              ) : null}
                              <Badge tone="attention">{instrument.findings.length}</Badge>
                            </div>
                          )}
                        </td>
                        <td className="nowrap">
                          <div>{queueAge(instrument.updatedAt)}</div>
                          <div className="data-table__sub">{formatDate(instrument.updatedAt)}</div>
                        </td>
                        <td>
                          <Link href={`/instruments/${instrument.id}`} className="btn btn--ghost btn--small">
                            Open
                          </Link>
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
              Last refreshed {formatDateTime(new Date())}. Queue age is time since last record
              change, not a regulatory deadline.
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
