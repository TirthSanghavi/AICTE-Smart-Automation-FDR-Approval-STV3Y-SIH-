import Link from "next/link";
import { loadCasePage } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CASE_DISCLAIMER,
  CASE_OPEN_STATUSES,
  CASE_TYPE_LABEL,
  ROLE,
  humanize,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { checklistSatisfied } from "@/lib/rules/checklist";
import { ApiForm } from "@/components/ApiForm";
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  DefinitionList,
  EmptyState,
  Notice,
  PageHead,
  StatusBadge,
} from "@/components/ui";

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const releaseCase = await loadCasePage(user, id);
  const instrument = releaseCase.instrument;
  const checklist = checklistSatisfied(releaseCase.tasks);
  const isOpen = CASE_OPEN_STATUSES.includes(releaseCase.status as never);
  const canWithdraw = user.role === ROLE.INSTITUTION_ADMIN && isOpen;
  const clearanceRoles: string[] = [ROLE.DEPT_REVIEWER, ROLE.SCRUTINY_OFFICER];
  const canRecordClearance = clearanceRoles.includes(user.role) && isOpen;
  const isAuthority = user.role === ROLE.COMPETENT_AUTHORITY;
  const authorityCompletedTask = releaseCase.tasks.some((task) => task.completedBy === user.id);

  const criticalOpen = await prisma.finding.count({
    where: {
      instrumentId: instrument.id,
      severity: "CRITICAL",
      resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] },
    },
  });

  const actorIds = [
    ...new Set([
      releaseCase.createdBy,
      ...releaseCase.tasks.map((task) => task.completedBy).filter((value): value is string => !!value),
      ...releaseCase.clearances.map((item) => item.verifiedBy).filter((value): value is string => !!value),
      ...releaseCase.decisions.map((item) => item.authorityUserId),
    ]),
  ];
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true, role: true },
  });
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));

  const required = releaseCase.tasks.filter((task) => task.required);
  const satisfied = required.filter(
    (task) => task.status === "COMPLETED" && task.outcome === "SATISFIED",
  ).length;

  return (
    <>
      <PageHead
        eyebrow={`${CASE_TYPE_LABEL[releaseCase.type] ?? releaseCase.type} · ${instrument.institution.name}`}
        title={instrument.fdrNumber}
        description={releaseCase.reason}
        actions={
          <>
            <Link href={`/instruments/${instrument.id}`} className="btn btn--ghost">
              Instrument record
            </Link>
            {canWithdraw ? (
              <ApiForm
                action={`/api/cases/${releaseCase.id}/withdraw`}
                submitLabel="Withdraw case"
                successMessage="Case withdrawn. The instrument lifecycle was not changed."
                confirmText="Withdraw this case? The case history is retained."
                className=""
                buttonClassName="btn btn--small btn--danger"
              />
            ) : null}
          </>
        }
      />

      <div className="badge-row" style={{ marginBottom: 18 }}>
        <StatusBadge value={releaseCase.status} />
        <Badge tone="muted">{releaseCase.templateLabel}</Badge>
        <Badge tone="neutral">Checklist {satisfied}/{required.length}</Badge>
        {criticalOpen > 0 ? <Badge tone="critical">{criticalOpen} critical finding(s)</Badge> : null}
        {authorityCompletedTask ? <Badge tone="critical">Separation-of-duties flag</Badge> : null}
      </div>

      <div style={{ marginBottom: 22 }}>
        <Notice tone="danger" title="Decision boundary">
          {CASE_DISCLAIMER} Case status is separate from instrument lifecycle; approval, rejection
          or withdrawal does not rewrite the underlying record.
        </Notice>
      </div>

      <div className="split">
        <div className="stack">
          <Card>
            <CardHead
              title="Compliance checklist"
              description="Illustrative template only. Required items must be completed with a SATISFIED outcome before approval."
              action={<Badge tone="muted">v{releaseCase.templateVersion}</Badge>}
            />
            <CardBody flush>
              <ul className="checklist">
                {releaseCase.tasks.map((task) => {
                  const done = task.status === "COMPLETED" && task.outcome === "SATISFIED";
                  const failed = task.status === "COMPLETED" && task.outcome === "NOT_SATISFIED";
                  const canComplete = isOpen && user.role === task.role && task.status !== "COMPLETED";
                  return (
                    <li
                      key={task.id}
                      className={`checklist__item ${done ? "checklist__item--done" : task.status === "COMPLETED" ? "" : "checklist__item--pending"}`}
                    >
                      <span className="checklist__marker">{done ? "✓" : failed ? "!" : task.stepOrder}</span>
                      <div>
                        <div className="row-between">
                          <div className="checklist__title">{task.title}</div>
                          <div className="badge-row">
                            {task.required ? <Badge tone="neutral">Required</Badge> : <Badge tone="muted">Optional</Badge>}
                            <StatusBadge value={task.outcome ?? task.status} />
                          </div>
                        </div>
                        <div className="checklist__desc">{task.description}</div>
                        <div className="checklist__meta">
                          <span>Role: {task.role.replaceAll("_", " ").toLowerCase()}</span>
                          {task.completedBy ? (
                            <span>
                              By {actorNames.get(task.completedBy) ?? "unknown"} · {formatDate(task.completedAt)}
                            </span>
                          ) : (
                            <span>Awaiting assigned role</span>
                          )}
                        </div>
                        {task.notes ? <div className="small muted" style={{ marginTop: 6 }}>{task.notes}</div> : null}

                        {canComplete ? (
                          <details className="disclosure">
                            <summary>Complete this task</summary>
                            <ApiForm
                              action={`/api/cases/${releaseCase.id}/tasks/${task.id}/complete`}
                              submitLabel="Save task outcome"
                              successMessage="Task outcome recorded and audited."
                              note="A SATISFIED outcome is required for approval. Notes are mandatory."
                            >
                              <div className="field">
                                <label htmlFor={`task-${task.id}-outcome`}>Outcome</label>
                                <select id={`task-${task.id}-outcome`} name="outcome" defaultValue="SATISFIED">
                                  <option value="SATISFIED">Satisfied</option>
                                  <option value="NOT_SATISFIED">Not satisfied / still outstanding</option>
                                </select>
                              </div>
                              <div className="field">
                                <label htmlFor={`task-${task.id}-notes`}>Notes and evidence reference</label>
                                <textarea id={`task-${task.id}-notes`} name="notes" required minLength={5} maxLength={2000} />
                              </div>
                            </ApiForm>
                          </details>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
            <div className="card__foot">
              <span>
                {checklist.complete
                  ? "All required checklist items are satisfied."
                  : "Approval is blocked until every required item has a SATISFIED outcome."}
              </span>
              <span className="mono tiny">{releaseCase.templateVersion}</span>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Clearances & NOCs"
              description="Recorded with issuer, reference, issue date and scope. A record here is reviewer-entered evidence, not independent issuer verification."
            />
            <CardBody flush>
              {releaseCase.clearances.length === 0 ? (
                <EmptyState
                  title="No clearances recorded"
                  description="The checklist requires PGRC and Vigilance items for the seeded release template."
                />
              ) : (
                <ul className="list-clean">
                  {releaseCase.clearances.map((clearance) => (
                    <li key={clearance.id} style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)" }}>
                      <div className="row-between">
                        <Badge tone="neutral">{clearance.kind}</Badge>
                        <span className="tiny muted">Issued {formatDate(clearance.issuedOn)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, marginTop: 5 }}>
                        {clearance.issuer} · <span className="mono">{clearance.reference}</span>
                      </div>
                      <div className="small muted" style={{ marginTop: 3 }}>{clearance.scope}</div>
                      <div className="tiny muted" style={{ marginTop: 4 }}>
                        Recorded by {actorNames.get(clearance.verifiedBy ?? "") ?? "reviewer"} ·{" "}
                        {formatDateTime(clearance.verifiedAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>

            {canRecordClearance ? (
              <div className="card__body" style={{ borderTop: "1px solid var(--line)" }}>
                <div className="tag" style={{ marginBottom: 8 }}>Record a clearance</div>
                <ApiForm
                  action={`/api/cases/${releaseCase.id}/clearances`}
                  submitLabel="Record clearance"
                  successMessage="Clearance recorded. It remains reviewer-entered evidence."
                  note="Do not treat an upload alone as proof of a valid NOC."
                >
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="kind">Clearance type</label>
                      <select id="kind" name="kind" defaultValue="PGRC">
                        <option value="PGRC">PGRC</option>
                        <option value="VIGILANCE">Vigilance</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="issuer">Issuer</label>
                      <input id="issuer" name="issuer" type="text" required maxLength={200} />
                    </div>
                    <div className="field">
                      <label htmlFor="reference">Reference</label>
                      <input id="reference" name="reference" type="text" required maxLength={120} />
                    </div>
                    <div className="field">
                      <label htmlFor="issuedOn">Issued on</label>
                      <input id="issuedOn" name="issuedOn" type="date" required />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="scope">Scope</label>
                    <input id="scope" name="scope" type="text" required maxLength={1000} />
                  </div>
                </ApiForm>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHead
              title="Decision history"
              description="Insert-only rows with actor, reason and a checklist snapshot at decision time."
            />
            <CardBody flush>
              {releaseCase.decisions.length === 0 ? (
                <EmptyState title="No decision yet" description="The competent authority records the final administrative decision." />
              ) : (
                releaseCase.decisions.map((decision) => (
                  <div key={decision.id} className="finding">
                    <div className="finding__top">
                      <StatusBadge value={decision.outcome} />
                      <span className="tiny muted">{formatDateTime(decision.decidedAt)}</span>
                    </div>
                    <div className="finding__title">{decision.reason}</div>
                    <div className="finding__basis">
                      Authority: {actorNames.get(decision.authorityUserId) ?? decision.authorityUserId} ·
                      checklist snapshot recorded
                    </div>
                    <details className="disclosure">
                      <summary>Checklist snapshot</summary>
                      <pre className="code-block">{decision.checklistSnapshot}</pre>
                    </details>
                  </div>
                ))
              )}
            </CardBody>
            <div className="card__foot">
              <span>Approval is an administrative record, not a bank instruction.</span>
            </div>
          </Card>
        </div>

        <aside className="stack">
          <Card>
            <CardHead title="Case facts" />
            <CardBody>
              <DefinitionList
                tight
                items={[
                  { label: "Case", value: <span className="mono">{releaseCase.id.slice(0, 8)}</span> },
                  { label: "Type", value: CASE_TYPE_LABEL[releaseCase.type] ?? releaseCase.type },
                  { label: "Status", value: <StatusBadge value={releaseCase.status} /> },
                  { label: "Institution", value: instrument.institution.name },
                  { label: "Amount", value: formatMoney(instrument.amount) },
                  { label: "Instrument", value: <StatusBadge value={instrument.lifecycleStatus} /> },
                  { label: "Opened", value: formatDate(releaseCase.createdAt) },
                  { label: "By", value: actorNames.get(releaseCase.createdBy) ?? "—" },
                  { label: "Template", value: releaseCase.templateVersion },
                  { label: "Rule version", value: releaseCase.ruleVersionId ?? "None approved" },
                ]}
              />
              <div className="tiny muted" style={{ marginTop: 10 }}>
                Instrument lifecycle remains {humanize(instrument.lifecycleStatus)} before and
                after this case unless a separate closure is authorized.
              </div>
            </CardBody>
          </Card>

          {isAuthority ? (
            <Card>
              <CardHead
                title="Competent-authority decision"
                description="Server-side checks: checklist completeness, separation of duties and open critical findings."
              />
              <CardBody>
                {!isOpen ? (
                  <Notice tone="quiet" title="Case closed">
                    This case already has a final status. Decisions are insert-only; open a new
                    case for a new request.
                  </Notice>
                ) : (
                  <>
                    {!checklist.complete ? (
                      <Notice tone="danger" title="Checklist incomplete">
                        Approval is blocked. Required items still outstanding:{" "}
                        {required
                          .filter((task) => !(task.status === "COMPLETED" && task.outcome === "SATISFIED"))
                          .map((task) => task.title)
                          .join("; ")}
                        .
                      </Notice>
                    ) : null}
                    {criticalOpen > 0 ? (
                      <div style={{ marginTop: checklist.complete ? 0 : 12 }}>
                        <Notice tone="danger" title="Critical findings open">
                          Resolve or formally override {criticalOpen} critical finding(s) before
                          approving.
                        </Notice>
                      </div>
                    ) : null}
                    {authorityCompletedTask ? (
                      <div style={{ marginTop: 12 }}>
                        <Notice tone="danger" title="Separation of duties">
                          You completed a checklist task on this case, so you cannot decide it.
                        </Notice>
                      </div>
                    ) : null}
                    <div style={{ marginTop: 14 }}>
                      <ApiForm
                        action={`/api/cases/${releaseCase.id}/decision`}
                        submitLabel="Record decision"
                        successMessage="Decision recorded. This is an administrative record only."
                        confirmText="Record this decision? It is insert-only and visible in the audit trail."
                        disabled={!checklist.complete || criticalOpen > 0 || authorityCompletedTask}
                        note={CASE_DISCLAIMER}
                      >
                        <div className="field">
                          <label htmlFor="outcome">Outcome</label>
                          <select id="outcome" name="outcome" defaultValue="APPROVED">
                            <option value="APPROVED">Approve</option>
                            <option value="REJECTED">Reject</option>
                            <option value="RETURNED">Return for correction</option>
                            <option value="ESCALATED">Escalate</option>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="decision-reason">Reason (required, audited)</label>
                          <textarea id="decision-reason" name="reason" required minLength={10} maxLength={2000} />
                        </div>
                      </ApiForm>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHead title="What happens next" />
              <CardBody>
                <div className="small muted">
                  The competent authority decides this case after the checklist is satisfied. Role
                  separation is enforced server-side: the officer who completed a task cannot be
                  the decision maker, and an institution submitter cannot decide its own case.
                </div>
              </CardBody>
            </Card>
          )}

          <Notice tone="quiet" title="Source status">
            No approved rule version is linked to this case. The checklist is illustrative and
            cannot be presented as an official AICTE sequence or a legal conclusion.
          </Notice>
        </aside>
      </div>
    </>
  );
}
