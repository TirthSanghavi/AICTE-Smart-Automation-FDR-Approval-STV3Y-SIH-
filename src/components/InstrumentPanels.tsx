import Link from "next/link";
import type {
  DocumentVersion,
  ExtractedField,
  ExtractionRun,
  Finding,
  ReleaseCase,
  ReviewTask,
  VerificationAttempt,
} from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import {
  CASE_DISCLAIMER,
  CASE_TYPE,
  CASE_TYPE_LABEL,
  CHECK_LIMITATION,
  ENDORSEMENT,
  ENDORSEMENT_LABEL,
  HOLDER_STRUCTURE_CONFIG,
  LIFECYCLE,
  ROLE,
  humanize,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/dates";
import { endorsementCaption } from "@/lib/services/endorsements";
import { fieldLabel, verificationCaption } from "@/lib/instrument-meta";
import { ApiForm } from "./ApiForm";
import { UploadForm } from "./UploadForm";
import { Badge, Card, CardBody, CardHead, DefinitionList, EmptyState, Notice, StatusBadge } from "./ui";

const EDITABLE = [LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED];

export function DocumentsCard({
  documents,
  latestRun,
  instrumentId,
  lifecycleStatus,
  user,
}: {
  documents: DocumentVersion[];
  latestRun: (ExtractionRun & { fields: ExtractedField[] }) | null;
  instrumentId: string;
  lifecycleStatus: string;
  user: SessionUser;
}) {
  const canEdit =
    user.role === ROLE.INSTITUTION_ADMIN && EDITABLE.includes(lifecycleStatus as never);
  return (
    <Card>
      <CardHead
        title="Documents & extraction"
        description="Private storage, versioned evidence, SHA-256 byte-integrity digest. A hash is not proof of authenticity."
      />
      <CardBody flush>
        {documents.length === 0 ? (
          <EmptyState
            title="No document uploaded"
            description={canEdit ? "Upload a PDF, JPG or PNG up to 10 MB to continue." : "The institution has not attached a document yet."}
          />
        ) : (
          <ul className="list-clean">
            {documents.map((document, index) => (
              <li key={document.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
                <div className="row-between">
                  <div>
                    <div style={{ fontSize: 13 }}>
                      v{document.versionNo} · {document.originalName}
                    </div>
                    <div className="tiny muted" style={{ marginTop: 3 }}>
                      {document.mime} · {(document.size / 1024).toFixed(1)} KB · uploaded{" "}
                      {formatDate(document.createdAt)}
                    </div>
                  </div>
                  <StatusBadge value={document.docStatus} />
                </div>
                <div className="mono tiny" style={{ marginTop: 6, color: "var(--muted-2)", overflowWrap: "anywhere" }}>
                  SHA-256 {document.sha256.slice(0, 24)}…{document.sha256.slice(-8)}
                </div>
                <div className="btn-row" style={{ marginTop: 9 }}>
                  <Link
                    href={`/api/documents/${document.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--ghost btn--small"
                  >
                    View document
                  </Link>
                  {index === 0 && latestRun ? (
                    <Link href={`/instruments/${instrumentId}/review`} className="btn btn--ghost btn--small">
                      {latestRun.status === "EXTRACTED" ? "Review extracted fields" : "Enter fields manually"}
                    </Link>
                  ) : null}
                </div>
                {index === 0 &&
                canEdit &&
                ["UPLOADED", "EXTRACTION_FAILED"].includes(document.docStatus) ? (
                  <div style={{ marginTop: 10 }}>
                    <ApiForm
                      action={`/api/documents/${document.id}/extract`}
                      submitLabel="Run mock extraction"
                      successMessage="Extraction run recorded. Review the document status and fields."
                      buttonClassName="btn btn--small"
                      note="Simulated extractor; failures preserve a manual-entry path."
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {canEdit ? (
        <div className="card__body" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="tag" style={{ marginBottom: 8 }}>
            Upload a {documents.length > 0 ? "new version" : "document"}
          </div>
          <UploadForm action={`/api/instruments/${instrumentId}/documents`} />
        </div>
      ) : null}
    </Card>
  );
}

export function FindingsCard({
  findings,
  lifecycleStatus,
  user,
}: {
  findings: Finding[];
  lifecycleStatus: string;
  user: SessionUser;
}) {
  const canRequest =
    user.role === ROLE.SCRUTINY_OFFICER &&
    [LIFECYCLE.SUBMITTED, LIFECYCLE.UNDER_REVIEW].includes(lifecycleStatus as never);
  const isAuthority = user.role === ROLE.COMPETENT_AUTHORITY;
  const isOfficer = user.role === ROLE.SCRUTINY_OFFICER;

  return (
    <Card>
      <CardHead
        title="Findings"
        description={CHECK_LIMITATION}
        action={<Badge tone={findings.some((f) => ["OPEN", "CORRECTION_REQUESTED"].includes(f.resolutionStatus)) ? "attention" : "muted"}>{findings.length} total</Badge>}
      />
      <CardBody flush>
        {findings.length === 0 ? (
          <EmptyState
            title="No findings recorded"
            description="Deterministic checks run when the record is submitted. Regulatory amount checks stay disabled until an approved rule version exists."
          />
        ) : (
          <div>
            {findings.map((finding) => {
              const active = ["OPEN", "CORRECTION_REQUESTED"].includes(finding.resolutionStatus);
              const critical = finding.severity === "CRITICAL";
              const canResolve = active && ((critical && isAuthority) || (!critical && isOfficer));
              return (
                <article key={finding.id} className="finding">
                  <div className="finding__top">
                    <div className="badge-row">
                      <Badge tone={critical ? "critical" : finding.severity === "HIGH" ? "attention" : "muted"}>
                        {humanize(finding.severity)}
                      </Badge>
                      <Badge tone="neutral">{finding.ruleId}</Badge>
                      <span className="finding__rule">{finding.field ? fieldLabel(finding.field) : "record"}</span>
                    </div>
                    <StatusBadge value={finding.resolutionStatus} />
                  </div>
                  <div className="finding__title">{finding.explanation}</div>
                  <div className="finding__text">
                    <strong>Observed:</strong> {finding.observed ?? "—"} · <strong>Expected:</strong>{" "}
                    {finding.expected ?? "—"}
                  </div>
                  <div className="finding__action">{finding.recommendedAction}</div>
                  <div className="finding__basis">{finding.basis}</div>
                  {finding.resolutionReason ? (
                    <div className="finding__basis">
                      Resolution: {humanize(finding.resolutionStatus)} — {finding.resolutionReason}
                    </div>
                  ) : null}

                  {canRequest ? (
                    <details className="disclosure">
                      <summary>Request correction</summary>
                      <ApiForm
                        action={`/api/findings/${finding.id}/request-correction`}
                        submitLabel="Send correction request"
                        successMessage="Correction requested and the institution was notified in-app."
                        confirmText="Request a correction on this record?"
                        note="Notifies institution admins. The instrument moves to CORRECTION_REQUESTED."
                      >
                        <div className="field">
                          <label htmlFor={`reason-${finding.id}`}>Reason (visible to the institution)</label>
                          <textarea id={`reason-${finding.id}`} name="reason" required maxLength={1000} />
                        </div>
                        <div className="field">
                          <label htmlFor={`due-${finding.id}`}>Target date (workflow target, not a legal deadline)</label>
                          <input id={`due-${finding.id}`} name="dueDate" type="date" />
                        </div>
                        <fieldset className="field" style={{ border: 0, padding: 0 }}>
                          <legend className="field__label">Fields to correct</legend>
                          <div className="form-grid">
                            {["bankName", "fdrNumber", "amount", "issueDate", "maturityDate", "holderName"].map((field) => (
                              <label key={field} className="check">
                                <input type="checkbox" name="requestedFields" value={field} />
                                {fieldLabel(field)}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </ApiForm>
                    </details>
                  ) : null}

                  {canResolve ? (
                    <details className="disclosure">
                      <summary>{critical ? "Override critical finding" : "Resolve finding"}</summary>
                      <ApiForm
                        action={`/api/findings/${finding.id}/resolve`}
                        submitLabel={critical ? "Record override" : "Resolve finding"}
                        successMessage="Finding updated; the record and audit trail were updated together."
                        confirmText={critical ? "Override this critical finding? The finding will be preserved in the audit trail." : undefined}
                        note={
                          critical
                            ? "Critical override requires the competent authority and a non-empty reason. The finding is preserved."
                            : "Dismissing a false positive also requires a reason."
                        }
                      >
                        {!critical ? (
                          <div className="field">
                            <label htmlFor={`resolution-${finding.id}`}>Resolution</label>
                            <select id={`resolution-${finding.id}`} name="resolution" defaultValue="RESOLVED">
                              <option value="RESOLVED">Resolved</option>
                              <option value="DISMISSED_FALSE_POSITIVE">Dismiss as false positive</option>
                            </select>
                          </div>
                        ) : (
                          <input type="hidden" name="resolution" value="RESOLVED" />
                        )}
                        <div className="field">
                          <label htmlFor={`resolve-reason-${finding.id}`}>Reason (required)</label>
                          <textarea id={`resolve-reason-${finding.id}`} name="reason" required minLength={5} maxLength={1000} />
                        </div>
                      </ApiForm>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </CardBody>
      <div className="card__foot">
        <span>OCR confidence is not a fraud score. Findings are explanations, not verdicts.</span>
        <Link href="/rules" className="tiny mono">Source register →</Link>
      </div>
    </Card>
  );
}

export function VerificationCard({
  attempts,
  documents,
  instrumentId,
  lifecycleStatus,
  user,
  blockingCount,
}: {
  attempts: VerificationAttempt[];
  documents: DocumentVersion[];
  instrumentId: string;
  lifecycleStatus: string;
  user: SessionUser;
  blockingCount: number;
}) {
  const verifyRoles: string[] = [ROLE.SCRUTINY_OFFICER, ROLE.COMPETENT_AUTHORITY];
  const canRecord =
    verifyRoles.includes(user.role) &&
    [LIFECYCLE.SUBMITTED, LIFECYCLE.UNDER_REVIEW].includes(lifecycleStatus as never);

  return (
    <Card>
      <CardHead
        title="Independent verification"
        description="Manual review and simulation are separate, labelled outcomes. Neither is automatically a bank confirmation."
      />
      <CardBody flush>
        {attempts.length === 0 ? (
          <EmptyState
            title="No verification attempt"
            description="Extraction and consistency checks do not verify the instrument. Record a manual review or a clearly labelled simulation."
          />
        ) : (
          <ul className="list-clean">
            {attempts.map((attempt) => (
              <li key={attempt.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
                <div className="row-between">
                  <div className="badge-row">
                    <StatusBadge value={attempt.status} />
                    {attempt.simulated ? <Badge tone="simulated">Simulated</Badge> : <Badge tone="muted">Manual record</Badge>}
                  </div>
                  <span className="tiny muted">{formatDateTime(attempt.asOf)}</span>
                </div>
                <div style={{ fontSize: 12.5, marginTop: 6 }}>{attempt.sourceName}</div>
                <div className="tiny muted">
                  {attempt.method} · reference {attempt.reference ?? "—"} · lien {attempt.lienStatus}
                </div>
                {attempt.notes ? <div className="small" style={{ marginTop: 5 }}>{attempt.notes}</div> : null}
                {attempt.limitations ? (
                  <div className="finding__basis">Limitation: {attempt.limitations}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {canRecord ? (
        <div className="card__body" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="tag" style={{ marginBottom: 8 }}>Record an outcome</div>
          {blockingCount > 0 ? (
            <Notice tone="danger" title="Critical findings block ordinary verification">
              {blockingCount} critical finding(s) are open. Resolve them first, or the competent
              authority may record an explicit override with a reason below.
            </Notice>
          ) : null}
          <div style={{ marginTop: blockingCount > 0 ? 14 : 0 }}>
            <ApiForm
              action={`/api/instruments/${instrumentId}/verification`}
              submitLabel="Record verification outcome"
              successMessage="Verification attempt recorded. Check the label: simulation is not bank confirmation."
              confirmText="Record this verification outcome? It will be added to the evidence history."
              note="Timeouts are recorded as inconclusive; no negative or positive result is inferred."
            >
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="method">Method</label>
                  <select id="method" name="method" defaultValue="SIMULATED">
                    <option value="SIMULATED">Simulated bank response (demo)</option>
                    <option value="MANUAL_CONFIRMATION">Manual review of external evidence</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="asOf">Source date & time</label>
                  <input id="asOf" name="asOf" type="datetime-local" />
                  <span className="field__hint">Defaults to now if left blank.</span>
                </div>
                <div className="field">
                  <label htmlFor="sourceName">Source name</label>
                  <input id="sourceName" name="sourceName" type="text" placeholder="Required for manual review" />
                </div>
                <div className="field">
                  <label htmlFor="reference">Source reference</label>
                  <input id="reference" name="reference" type="text" placeholder="Required for manual review" />
                </div>
                <div className="field">
                  <label htmlFor="evidenceDocumentId">Evidence attachment (optional)</label>
                  <select id="evidenceDocumentId" name="evidenceDocumentId" defaultValue="">
                    <option value="">No attachment recorded</option>
                    {documents.map((document) => (
                      <option key={document.id} value={document.id}>
                        v{document.versionNo} · {document.originalName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="notes">Review notes</label>
                <textarea id="notes" name="notes" placeholder="What was compared, by whom, and what remains unverified?" />
              </div>
              <div className="field">
                <label htmlFor="limitations">Limitations</label>
                <input id="limitations" name="limitations" type="text" placeholder="e.g. Email copy only; bank API unavailable" />
              </div>
              {blockingCount > 0 && user.role === ROLE.COMPETENT_AUTHORITY ? (
                <div className="field">
                  <label htmlFor="overrideReason">Override reason (authority only)</label>
                  <textarea id="overrideReason" name="overrideReason" minLength={10} />
                  <span className="field__hint">
                    A critical finding is preserved; the override is separately audited.
                  </span>
                </div>
              ) : null}
            </ApiForm>
          </div>
        </div>
      ) : null}
      <div className="card__foot">
        <span>{verificationCaption(attempts[0]?.status ?? "NOT_CHECKED")}</span>
      </div>
    </Card>
  );
}

export function CasesCard({
  cases,
  instrumentId,
  lifecycleStatus,
  user,
}: {
  cases: (ReleaseCase & { tasks: ReviewTask[] })[];
  instrumentId: string;
  lifecycleStatus: string;
  user: SessionUser;
}) {
  const canCreate =
    user.role === ROLE.INSTITUTION_ADMIN &&
    ![LIFECYCLE.DRAFT, LIFECYCLE.CLOSED, LIFECYCLE.ARCHIVED, LIFECYCLE.REPLACED].includes(
      lifecycleStatus as never,
    );

  return (
    <Card>
      <CardHead
        title="Release & extension cases"
        description={CASE_DISCLAIMER}
        action={<Link href="/cases" className="btn btn--ghost btn--small">All cases</Link>}
      />
      <CardBody flush>
        {cases.length === 0 ? (
          <EmptyState title="No cases for this record" description="Opening a case does not change the instrument lifecycle." />
        ) : (
          <ul className="list-clean">
            {cases.map((item) => {
              const required = item.tasks.filter((task) => task.required);
              const progress = required.filter(
                (task) => task.status === "COMPLETED" && task.outcome === "SATISFIED",
              );
              return (
                <li key={item.id} style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)" }}>
                  <div className="row-between">
                    <Link href={`/cases/${item.id}`} style={{ fontSize: 13 }}>
                      {CASE_TYPE_LABEL[item.type] ?? item.type}
                    </Link>
                    <StatusBadge value={item.status} />
                  </div>
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    {progress.length}/{required.length} required checklist items satisfied ·{" "}
                    {item.templateLabel}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {canCreate ? (
        <div className="card__body" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="tag" style={{ marginBottom: 8 }}>Open a case</div>
          <ApiForm
            action={`/api/instruments/${instrumentId}/cases`}
            submitLabel="Open case"
            successMessage="Case opened with an illustrative checklist. The instrument lifecycle was not changed."
            note="The seeded checklist is illustrative and not an official AICTE sequence."
          >
            <div className="field">
              <label htmlFor="type">Case type</label>
              <select id="type" name="type" defaultValue={CASE_TYPE.RELEASE}>
                {Object.values(CASE_TYPE).map((type) => (
                  <option key={type} value={type}>{CASE_TYPE_LABEL[type] ?? type}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="case-reason">Reason</label>
              <textarea id="case-reason" name="reason" required maxLength={2000} />
            </div>
          </ApiForm>
        </div>
      ) : null}
    </Card>
  );
}

export function EndorsementCard({
  instrumentId,
  holderName,
  lifecycleStatus,
  endorsement,
  user,
}: {
  instrumentId: string;
  holderName: string;
  lifecycleStatus: string;
  endorsement: {
    status: string;
    officerName: string | null;
    officerReference: string | null;
    endorsedAt: Date | null;
    documentRef: string | null;
    remarks: string | null;
  } | null;
  user: SessionUser;
}) {
  const status = endorsement?.status ?? ENDORSEMENT.NOT_REQUIRED;
  const canRequest =
    user.role === ROLE.INSTITUTION_ADMIN &&
    [ENDORSEMENT.NOT_REQUIRED, ENDORSEMENT.PENDING, ENDORSEMENT.WITHDRAWN].includes(status as never) &&
    ![LIFECYCLE.REPLACED, LIFECYCLE.ARCHIVED].includes(lifecycleStatus as never);
  const canWithdraw = user.role === ROLE.INSTITUTION_ADMIN && status === ENDORSEMENT.PENDING;
  const canDecide =
    (user.role === ROLE.SCRUTINY_OFFICER || user.role === ROLE.COMPETENT_AUTHORITY) &&
    ![ENDORSEMENT.ENDORSED].includes(status as never);

  return (
    <Card>
      <CardHead
        title="Holder structure & officer endorsement"
        description="Primary holder and AICTE endorsement are modelled separately."
        action={<StatusBadge value={status} label={ENDORSEMENT_LABEL[status] ?? humanize(status)} />}
      />
      <CardBody>
        <DefinitionList
          tight
          items={[
            { label: "Primary holder", value: holderName },
            {
              label: "AICTE relationship",
              value: HOLDER_STRUCTURE_CONFIG.aicteJointHolder
                ? "Joint account holder (configured)"
                : "Separate officer endorsement — not a joint holder",
            },
            { label: "Endorsement status", value: ENDORSEMENT_LABEL[status] ?? humanize(status) },
            { label: "Designated officer", value: endorsement?.officerName ?? "—" },
            { label: "Officer reference", value: endorsement?.officerReference ?? "—" },
            { label: "Endorsed at", value: endorsement?.endorsedAt ? formatDateTime(endorsement.endorsedAt) : "—" },
            { label: "Supporting document", value: endorsement?.documentRef ?? "—" },
            { label: "Remarks", value: endorsement?.remarks ?? "—" },
          ]}
        />
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {endorsementCaption(endorsement?.status)}
        </div>

        {canRequest ? (
          <details className="disclosure">
            <summary>Request officer endorsement</summary>
            <ApiForm
              action={`/api/instruments/${instrumentId}/endorsement`}
              submitLabel="Submit request"
              successMessage="Endorsement request recorded for officer decision."
              confirmText="Submit an endorsement request?"
              note="Nothing is approved automatically; an officer records the decision."
            >
              <input type="hidden" name="status" value={ENDORSEMENT.PENDING} />
              <div className="field">
                <label htmlFor={`end-remarks-${instrumentId}`}>Remarks / justification</label>
                <textarea id={`end-remarks-${instrumentId}`} name="remarks" maxLength={1000} />
              </div>
            </ApiForm>
          </details>
        ) : null}

        {canWithdraw ? (
          <div style={{ marginTop: 8 }}>
            <ApiForm
              action={`/api/instruments/${instrumentId}/endorsement`}
              submitLabel="Withdraw request"
              successMessage="Endorsement request withdrawn."
              buttonClassName="btn btn--ghost btn--small"
              className=""
            >
              <input type="hidden" name="status" value={ENDORSEMENT.WITHDRAWN} />
            </ApiForm>
          </div>
        ) : null}

        {canDecide ? (
          <details className="disclosure">
            <summary>Record officer decision</summary>
            <ApiForm
              action={`/api/instruments/${instrumentId}/endorsement`}
              submitLabel="Record endorsement"
              successMessage="Endorsement recorded and written to the audit trail."
              confirmText="Record this officer endorsement?"
              note="Officer identity and reference come from your own submission; the system fabricates nothing."
            >
              <input type="hidden" name="status" value={ENDORSEMENT.ENDORSED} />
              <div className="form-grid">
                <div className="field">
                  <label htmlFor={`end-officer-${instrumentId}`}>Designated officer name</label>
                  <input id={`end-officer-${instrumentId}`} name="officerName" type="text" required maxLength={160} defaultValue={user.name} />
                </div>
                <div className="field">
                  <label htmlFor={`end-ref-${instrumentId}`}>Designation / authorization reference</label>
                  <input id={`end-ref-${instrumentId}`} name="officerReference" type="text" required maxLength={80} placeholder="e.g. JD (Security) · AUTH-2026-114" />
                </div>
                <div className="field">
                  <label htmlFor={`end-doc-${instrumentId}`}>Supporting document reference</label>
                  <input id={`end-doc-${instrumentId}`} name="documentRef" type="text" maxLength={200} />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`end-note-${instrumentId}`}>Remarks</label>
                <textarea id={`end-note-${instrumentId}`} name="remarks" maxLength={1000} />
              </div>
            </ApiForm>
            <ApiForm
              action={`/api/instruments/${instrumentId}/endorsement`}
              submitLabel="Refuse endorsement"
              successMessage="Refusal recorded with your reason."
              confirmText="Record a refusal? A reason is required."
              className="form"
              buttonClassName="btn btn--ghost"
            >
              <input type="hidden" name="status" value={ENDORSEMENT.REJECTED} />
              <div className="field">
                <label htmlFor={`end-reject-${instrumentId}`}>Reason for refusal (required)</label>
                <textarea id={`end-reject-${instrumentId}`} name="remarks" required minLength={5} maxLength={1000} />
              </div>
            </ApiForm>
          </details>
        ) : null}
      </CardBody>
      <div className="card__foot">
        <span>Configuration: {HOLDER_STRUCTURE_CONFIG.mode} · endorsement required for submission: {HOLDER_STRUCTURE_CONFIG.requiredForSubmission ? "yes" : "no"}.</span>
      </div>
    </Card>
  );
}

export function TimelineCard({
  history,
  userNames,
}: {
  history: { id: string; versionNo: number; reason: string | null; changedBy: string; changedAt: Date }[];
  userNames: Map<string, string>;
}) {
  return (
    <Card>
      <CardHead title="Evidence timeline" description="Insert-only record versions; prior snapshots remain readable." />
      <CardBody>
        {history.length === 0 ? (
          <EmptyState title="No versions yet" />
        ) : (
          <ul className="timeline">
            {history.map((item) => (
              <li key={item.id} className={`timeline__item${item.versionNo === history[0]?.versionNo ? " timeline__item--accent" : ""}`}>
                <span className="timeline__dot" aria-hidden="true" />
                <div>
                  <div className="timeline__title">{item.reason ?? "Record version"}</div>
                  <div className="timeline__meta">
                    v{item.versionNo} · {formatDateTime(item.changedAt)} · {userNames.get(item.changedBy) ?? "System"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
