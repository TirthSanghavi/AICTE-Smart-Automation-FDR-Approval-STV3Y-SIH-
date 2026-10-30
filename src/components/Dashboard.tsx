import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import {
  adminOverview,
  auditorOverview,
  authorityOverview,
  institutionOverview,
  officerOverview,
  reviewerOverview,
} from "@/lib/queries/dashboard";
import {
  CASE_TYPE_LABEL,
  ROLE,
  SYNTHETIC_BANNER,
  humanize,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { LIFECYCLE_LABEL } from "@/lib/instrument-meta";
import { ApiForm } from "./ApiForm";
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
} from "./ui";

function daysAgo(date: Date): string {
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function Notifications({
  items,
}: {
  items: { id: string; title: string; body: string; createdAt: Date; type: string }[];
}) {
  return (
    <Card>
      <CardHead
        title="Inbox"
        description="In-app notifications only. No email, SMS or WhatsApp delivery."
      />
      {items.length === 0 ? (
        <EmptyState title="Nothing unread" description="New assignments and outcomes appear here." />
      ) : (
        <ul className="list-clean">
          {items.map((item) => (
            <li
              key={item.id}
              style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)" }}
            >
              <div className="row-between">
                <span className="tag">{humanize(item.type)}</span>
                <span className="tiny muted">{formatDate(item.createdAt)}</span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>{item.title}</div>
              <div className="small muted" style={{ marginTop: 2 }}>{item.body}</div>
              <div style={{ marginTop: 8 }}>
                <ApiForm
                  action={`/api/notifications/${item.id}/read`}
                  submitLabel="Mark read"
                  buttonClassName="btn btn--ghost btn--small"
                  successMessage="Marked as read."
                  className=""
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AlertsCard({
  alerts,
  canAck = true,
}: {
  alerts: {
    id: string;
    thresholdDays: number;
    sentAt: Date;
    status: string;
    instrument: { fdrNumber: string; maturityDate: Date; id: string };
  }[];
  canAck?: boolean;
}) {
  return (
    <Card>
      <CardHead
        title="Maturity alerts"
        description="In-app, date-derived, deduplicated per threshold."
        action={<Link href="/alerts" className="btn btn--ghost btn--small">Open tracker</Link>}
      />
      {alerts.length === 0 ? (
        <EmptyState
          title="No open alerts"
          description="Run the maturity scan under Alerts to evaluate the demo clock again."
        />
      ) : (
        <ul className="list-clean">
          {alerts.map((alert) => (
            <li key={alert.id} style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
              <div className="row-between">
                <Link href={`/instruments/${alert.instrument.id}`} className="mono" style={{ fontSize: 11.5 }}>
                  {alert.instrument.fdrNumber}
                </Link>
                <Badge tone={alert.thresholdDays === 0 ? "critical" : "attention"}>
                  {alert.thresholdDays === 0 ? "Matured" : `${alert.thresholdDays}-day`}
                </Badge>
              </div>
              <div className="tiny muted" style={{ marginTop: 3 }}>
                Matures {formatDate(alert.instrument.maturityDate)} · sent {formatDate(alert.sentAt)}
              </div>
              {canAck ? (
                <div style={{ marginTop: 7 }}>
                  <ApiForm
                    action={`/api/alerts/${alert.id}/ack`}
                    submitLabel="Acknowledge"
                    buttonClassName="btn btn--ghost btn--small"
                    successMessage="Alert acknowledged."
                    className=""
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function recentInstrumentTable(
  instruments: {
    id: string;
    fdrNumber: string;
    bankName: string;
    amount: { toString(): string };
    maturityDate: Date;
    lifecycleStatus: string;
    findings: { id: string; severity: string }[];
  }[],
) {
  if (instruments.length === 0) {
    return (
      <EmptyState
        title="No instruments yet"
        description="Add your first FDR to start the record."
        action={<Link href="/instruments/new" className="btn">New FDR record</Link>}
      />
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>FDR / bank</th>
            <th>Amount</th>
            <th>Maturity</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {instruments.map((instrument) => (
            <tr key={instrument.id}>
              <td>
                <Link href={`/instruments/${instrument.id}`} className="data-table__primary mono">
                  {instrument.fdrNumber}
                </Link>
                <div className="data-table__sub">{instrument.bankName}</div>
              </td>
              <td className="amount">{formatMoney(instrument.amount)}</td>
              <td className="nowrap">{formatDate(instrument.maturityDate)}</td>
              <td>
                <StatusBadge value={instrument.lifecycleStatus} label={LIFECYCLE_LABEL[instrument.lifecycleStatus]} />
                {instrument.findings.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    <Badge tone="critical">{instrument.findings.length} finding(s)</Badge>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function InstitutionDashboard({ user }: { user: SessionUser }) {
  const data = await institutionOverview(user);
  return (
    <>
      <PageHead
        eyebrow="Institution workspace"
        title="Your deposit register, in one view."
        description={
          <>
            {user.institutionName ?? "Your institution"} · records, evidence, corrections,
            maturity and release cases. All fixtures on this screen are synthetic.
          </>
        }
        actions={
          <>
            <Link href="/instruments/new" className="btn">New FDR record</Link>
            <Link href="/alerts" className="btn btn--ghost">Maturity tracker</Link>
          </>
        }
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Records" value={data.total} detail={`${data.active} active · ${data.correctionCount} correction item(s)`} />
          <Stat
            label="Maturing ≤ 90 days"
            value={data.maturingCount}
            href="/alerts"
            detail={data.maturingCount > 0 ? "Review renewal or release" : "Nothing in the 90-day window"}
            attention={data.maturingCount > 0}
          />
          <Stat
            label="Matured, no action"
            value={data.overdueCount}
            href="/alerts"
            detail="Date-derived, lifecycle unchanged"
            attention={data.overdueCount > 0}
          />
          <Stat label="Open release cases" value={data.openCases} href="/cases" detail="Decision may be pending" />
          <Stat
            label="Principal on register"
            value={formatMoney(data.principal, { compact: true })}
            money
            detail="Confirmed amounts, non-closed records (demo)"
          />
        </div>

        {data.criticalFindings > 0 ? (
          <Notice tone="danger" title="Blocking findings">
            {data.criticalFindings} critical finding(s) must be resolved or overridden by the
            competent authority before verification or release approval. Extraction and checks
            are not authenticity proof.
          </Notice>
        ) : (
          <Notice tone="warn" title="Trust boundary">
            {SYNTHETIC_BANNER}. Extraction, consistency checks and simulated bank responses are
            separate from independent confirmation. No record here is treated as genuine bank
            evidence.
          </Notice>
        )}

        <div className="split">
          <div className="stack">
            <Card>
              <CardHead
                title="Recent records"
                description="Ordered by last change; open a record to review evidence and status."
                action={<Link href="/instruments" className="btn btn--ghost btn--small">All records</Link>}
              />
              <CardBody flush>{recentInstrumentTable(data.instruments)}</CardBody>
            </Card>

            <Card>
              <CardHead
                title="How a record moves"
                description="Lifecycle states are separate from date-derived maturity buckets and case status."
              />
              <CardBody>
                <div className="badge-row">
                  <Badge tone="muted">Draft</Badge>
                  <span className="tiny muted">→</span>
                  <Badge tone="attention">Submitted</Badge>
                  <span className="tiny muted">→</span>
                  <Badge tone="attention">Under review</Badge>
                  <span className="tiny muted">→</span>
                  <Badge tone="good">Active</Badge>
                  <span className="tiny muted">→</span>
                  <Badge tone="muted">Closed</Badge>
                </div>
                <p className="small muted" style={{ marginTop: 12, maxWidth: "72ch" }}>
                  Correction requests branch from review. A release case, approval or withdrawal
                  never silently rewrites the instrument&apos;s lifecycle. “Maturing” and “matured” are
                  derived from the maturity date and today&apos;s clock.
                </p>
              </CardBody>
            </Card>
          </div>

          <div className="stack">
            <AlertsCard alerts={data.alerts} />
            <Notifications items={data.notifications} />
          </div>
        </div>
      </div>
    </>
  );
}

async function OfficerDashboard({ user }: { user: SessionUser }) {
  const data = await officerOverview(user);
  return (
    <>
      <PageHead
        eyebrow="Scrutiny desk"
        title="Evidence first. Explanations next."
        description="Submitted records, open findings and the age of the queue. Checks compare data consistency; they do not establish authenticity."
        actions={<Link href="/queue" className="btn">Open review queue</Link>}
      />
      <div className="stack">
        <div className="stat-grid">
          <Stat label="Awaiting pickup" value={data.submitted} href="/queue" detail="Submitted, not yet claimed" attention={data.submitted > 0} />
          <Stat label="Under review" value={data.underReview} href="/queue" detail="Claimed by scrutiny" />
          <Stat label="Open findings" value={data.openFindings} href="/instruments" detail="Open or correction requested" />
          <Stat label="Critical open" value={data.criticalOpen} detail="Authority override required" attention={data.criticalOpen > 0} />
          <Stat label="Checklist tasks" value={data.pendingTasks} href="/cases" detail="Assigned to scrutiny officers" />
        </div>

        <div className="split">
          <div className="stack">
            <Card>
              <CardHead
                title="Current queue"
                description="Oldest first. Critical findings are shown before an outcome can be recorded."
                action={<Link href="/queue" className="btn btn--ghost btn--small">Full queue</Link>}
              />
              <CardBody flush>
                {data.queue.length === 0 ? (
                  <EmptyState title="Queue is clear" description="No submitted or under-review records right now." />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Record</th>
                          <th>Institution</th>
                          <th>Amount</th>
                          <th>In queue</th>
                          <th>Findings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.queue.map((instrument) => (
                          <tr key={instrument.id}>
                            <td>
                              <Link href={`/instruments/${instrument.id}`} className="data-table__primary mono">
                                {instrument.fdrNumber}
                              </Link>
                              <div className="data-table__sub">
                                {instrument.bankName} · <StatusBadge value={instrument.lifecycleStatus} />
                              </div>
                            </td>
                            <td>{instrument.institution.name}</td>
                            <td className="amount">{formatMoney(instrument.amount)}</td>
                            <td className="nowrap">{daysAgo(instrument.updatedAt)}</td>
                            <td>
                              {instrument.findings.length === 0 ? (
                                <span className="muted tiny">None</span>
                              ) : (
                                <div className="badge-row">
                                  {instrument.findings.some((f) => f.severity === "CRITICAL") ? (
                                    <Badge tone="critical">Critical</Badge>
                                  ) : null}
                                  <Badge tone="attention">{instrument.findings.length} open</Badge>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>

            <Notice tone="info" title="What you can do here">
              Claim a submitted record, review the extraction side-by-side, request correction,
              resolve non-critical findings, then record a manual or simulated verification
              outcome. Critical findings need the competent authority.
            </Notice>
          </div>
          <Notifications items={data.notifications} />
        </div>
      </div>
    </>
  );
}

async function AuthorityDashboard() {
  const data = await authorityOverview();
  return (
    <>
      <PageHead
        eyebrow="Competent authority"
        title="Decide with the whole case in view."
        description="Checklist completeness and separation of duties are re-checked server-side at the moment of decision. Approval records an administrative decision only."
        actions={<Link href="/cases" className="btn">All cases</Link>}
      />
      <div className="stack">
        <div className="stat-grid">
          <Stat label="Awaiting decision" value={data.cases.length} href="/cases" detail="Open, returned or escalated" attention={data.cases.length > 0} />
          <Stat label="Aging > 30 days" value={data.aging.overMonth} detail={`${data.aging.underWeek} ≤7d · ${data.aging.underMonth} 8–30d`} attention={data.aging.overMonth > 0} />
          <Stat label="Critical open" value={data.criticalOpen} href="/instruments" detail="Blocks approval without override" attention={data.criticalOpen > 0} />
          <Stat label="Approved, open records" value={data.approvedActive.length} detail="Portal closure is separate" />
        </div>

        <Notice tone="danger" title="Approval is not execution">
          A decision here does not issue a bank instruction, confirm lien status, or move funds.
          Instrument closure is a separate administrative record.
        </Notice>

        <Card>
          <CardHead
            title="Cases awaiting decision"
            description="Required checklist items must be satisfied before approval. Returned cases can be decided again after correction."
          />
          <CardBody flush>
            {data.cases.length === 0 ? (
              <EmptyState title="No cases awaiting decision" description="Open and returned cases appear here." />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Case / institution</th>
                      <th>Type</th>
                      <th>Checklist</th>
                      <th>Age</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cases.map((item) => {
                      const required = item.tasks.filter((task) => task.required);
                      const satisfied = required.filter(
                        (task) => task.status === "COMPLETED" && task.outcome === "SATISFIED",
                      ).length;
                      return (
                        <tr key={item.id}>
                          <td>
                            <Link href={`/cases/${item.id}`} className="data-table__primary mono">
                              {item.instrument.fdrNumber}
                            </Link>
                            <div className="data-table__sub">
                              {item.institution.name} · {formatMoney(item.instrument.amount)}
                            </div>
                          </td>
                          <td>
                            <div>{CASE_TYPE_LABEL[item.type] ?? item.type}</div>
                            <div style={{ marginTop: 4 }}>
                              <StatusBadge value={item.status} />
                            </div>
                          </td>
                          <td>
                            <div className="mono" style={{ fontSize: 11 }}>
                              {satisfied}/{required.length}
                            </div>
                            <div className="data-table__sub">
                              {satisfied === required.length ? "Ready" : "Incomplete"}
                            </div>
                          </td>
                          <td className="nowrap">{daysAgo(item.createdAt)}</td>
                          <td>
                            <Link href={`/cases/${item.id}`} className="btn btn--ghost btn--small">
                              Review
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="split">
          <Card>
            <CardHead title="Recent decisions" description="Insert-only records with actor, reason and checklist snapshot." />
            <CardBody flush>
              {data.decisions.length === 0 ? (
                <EmptyState title="No decisions yet" description="Decisions will appear here with their reason and actor." />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Decision</th>
                        <th>Record</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.decisions.map((decision) => (
                        <tr key={decision.id}>
                          <td>
                            <StatusBadge value={decision.outcome} />
                            <div className="data-table__sub">{decision.reason}</div>
                          </td>
                          <td>
                            <Link href={`/cases/${decision.caseId}`} className="mono" style={{ fontSize: 11 }}>
                              {decision.case.instrument.fdrNumber}
                            </Link>
                          </td>
                          <td className="nowrap">{formatDate(decision.decidedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Approved, still active" description="Closure must be recorded separately and explicitly." />
            <CardBody flush>
              {data.approvedActive.length === 0 ? (
                <EmptyState title="Nothing to close" description="Approved cases on active records appear here." />
              ) : (
                <ul className="list-clean">
                  {data.approvedActive.map((item) => (
                    <li key={item.id} style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
                      <Link href={`/instruments/${item.instrument.id}`} className="mono" style={{ fontSize: 11.5 }}>
                        {item.instrument.fdrNumber}
                      </Link>
                      <div className="data-table__sub">{item.institution.name}</div>
                      <div className="tiny muted" style={{ marginTop: 3 }}>
                        Instrument remains {item.instrument.lifecycleStatus}. Open the record to close it explicitly.
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

async function ReviewerDashboard({ user }: { user: SessionUser }) {
  const data = await reviewerOverview(user);
  return (
    <>
      <PageHead
        eyebrow="Departmental review"
        title="Record the clearance, then the task."
        description="Clearances are recorded with issuer, reference, scope and date. A recorded clearance is not independently verified with the issuing cell."
        actions={<Link href="/cases" className="btn">All cases</Link>}
      />
      <div className="stat-grid">
        <Stat label="Tasks assigned to you" value={data.pending.length} href="/cases" detail="Across open cases" attention={data.pending.length > 0} />
        <Stat label="Completed by you" value={data.completed.length} detail="Recent review tasks" />
      </div>

      <div className="stack" style={{ marginTop: 24 }}>
        <Card>
          <CardHead title="Pending review tasks" description="Only your role can complete these items; the server enforces it." />
          <CardBody flush>
            {data.pending.length === 0 ? (
              <EmptyState title="No pending review tasks" description="New assignments will appear here." />
            ) : (
              <ul className="list-clean">
                {data.pending.map((task) => (
                  <li key={task.id} style={{ padding: "15px 18px", borderBottom: "1px solid var(--line)" }}>
                    <div className="row-between">
                      <span className="checklist__title">{task.case.instrument.fdrNumber}</span>
                      <Badge tone="attention">Task {task.stepOrder}</Badge>
                    </div>
                    <div className="data-table__sub">
                      {task.case.institution.name} · {CASE_TYPE_LABEL[task.case.type] ?? task.case.type}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12.5 }}>{task.title}</div>
                    <div className="small muted" style={{ marginTop: 3 }}>{task.description}</div>
                    <div style={{ marginTop: 9 }}>
                      <Link href={`/cases/${task.caseId}`} className="btn btn--ghost btn--small">
                        Open case workspace
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Recently completed" description="Your own completed review tasks." />
          <CardBody flush>
            {data.completed.length === 0 ? (
              <EmptyState title="No completed tasks yet" />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Task</th>
                      <th>Outcome</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.completed.map((task) => (
                      <tr key={task.id}>
                        <td className="mono">{task.case.instrument.fdrNumber}</td>
                        <td>{task.title}</td>
                        <td><StatusBadge value={task.outcome ?? "COMPLETED"} /></td>
                        <td className="nowrap">{formatDate(task.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

async function AuditorDashboard({ user }: { user: SessionUser }) {
  const data = await auditorOverview(user);
  return (
    <>
      <PageHead
        eyebrow="Audit workspace"
        title="Every state change leaves a mark."
        description="Append-only business history with a hash chain. Read-only oversight across institutions and decisions."
        actions={<Link href="/audit" className="btn">Open audit trail</Link>}
      />
      <div className="stack">
        <div className="stat-grid">
          <Stat label="Audit events" value={data.total} href="/audit" detail="Hash-chained, append-only" />
          <Stat label="Denied access" value={data.denied} href="/audit?action=access.denied" detail="Authorization denials recorded" attention={data.denied > 0} />
          <Stat label="Overrides" value={data.overrides} href="/audit?action=finding.overridden" detail="Critical finding / verification overrides" attention={data.overrides > 0} />
          <Stat label="Decisions" value={data.decisions} href="/cases" detail="Administrative records only" />
          <Stat label="Instruments" value={data.instruments} href="/instruments" detail="Synthetic fixtures" />
        </div>

        <div className="split">
          <Card>
            <CardHead title="Latest events" description="Newest first by append-only chain index." action={<Link className="btn btn--ghost btn--small" href="/audit">All events</Link>} />
            <CardBody flush>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Entity</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((event) => (
                      <tr key={event.id}>
                        <td className="mono" style={{ fontSize: 10.5 }}>{event.action}</td>
                        <td>
                          <div>{event.actor?.name ?? "System / unauthenticated"}</div>
                          <div className="data-table__sub">{event.actorRole ?? "—"}</div>
                        </td>
                        <td>
                          <div className="mono" style={{ fontSize: 10 }}>{event.entityType}</div>
                          <div className="data-table__sub" style={{ maxWidth: 200, overflowWrap: "anywhere" }}>
                            {event.entityId}
                          </div>
                        </td>
                        <td className="nowrap">{formatDateTime(event.ts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <div className="stack">
            <Card>
              <CardHead title="Event mix" description="Most frequent actions in this demo database." />
              <CardBody>
                <ul className="list-clean">
                  {data.actionCounts.map((row) => (
                    <li key={row.action} className="row-between" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                      <span className="mono" style={{ fontSize: 10.5 }}>{row.action}</span>
                      <span className="amount">{row._count._all}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Notice tone="quiet" title="Limits of the chain">
              The hash chain detects accidental or naive edits. A database administrator could
              rewrite rows and recompute the chain. This prototype does not provide external
              timestamping or a separate audit database.
            </Notice>
          </div>
        </div>
      </div>
    </>
  );
}

async function AdminDashboard() {
  const data = await adminOverview();
  return (
    <>
      <PageHead
        eyebrow="System administration"
        title="Configuration, with the safety rails visible."
        description="This prototype has no rule-publishing UI. Every regulatory version is PENDING_CONFIRMATION and cannot be applied as authority."
        actions={<Link href="/rules" className="btn">Source register</Link>}
      />
      <div className="stack">
        <div className="stat-grid">
          <Stat label="Users" value={data.users} detail="Seeded demo accounts" />
          <Stat label="Rules pending" value={data.pendingRules} href="/rules" detail="No active approved version" attention={data.pendingRules > 0} />
          <Stat label="Active rules" value={data.activeRules} detail="Required before automated rule evaluation" />
          <Stat label="Audit events" value={data.auditCount} href="/audit" detail="Append-only" />
          <Stat label="Instruments" value={data.instruments} href="/instruments" detail="Synthetic records" />
        </div>

        <Notice tone="warn" title="Demo-only controls">
          The frozen clock, reset seed and mock adapters exist only for local demonstration.
          They are not a production configuration surface. Rule publication would require
          two-person approval and an approved source version.
        </Notice>

        <Card>
          <CardHead title="Recent platform activity" description="Latest state changes across the demo database." />
          <CardBody flush>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Entity</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((event) => (
                    <tr key={event.id}>
                      <td className="mono" style={{ fontSize: 10.5 }}>{event.action}</td>
                      <td>{event.actor?.name ?? "System"}</td>
                      <td className="mono" style={{ fontSize: 10 }}>{event.entityType}</td>
                      <td className="nowrap">{formatDateTime(event.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

export async function Dashboard({ user }: { user: SessionUser }) {
  switch (user.role) {
    case ROLE.INSTITUTION_ADMIN:
    case ROLE.INSTITUTION_VIEWER:
      return <InstitutionDashboard user={user} />;
    case ROLE.SCRUTINY_OFFICER:
      return <OfficerDashboard user={user} />;
    case ROLE.COMPETENT_AUTHORITY:
      return <AuthorityDashboard />;
    case ROLE.DEPT_REVIEWER:
      return <ReviewerDashboard user={user} />;
    case ROLE.AUDITOR:
      return <AuditorDashboard user={user} />;
    case ROLE.SYSTEM_ADMIN:
      return <AdminDashboard />;
    default:
      return (
        <PageHead
          title="No workspace assigned"
          description="This account has no user interface. Integration service accounts are limited to adapter writes."
        />
      );
  }
}
