import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadInstrumentPage } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import {
  CASE_DISCLAIMER,
  CASE_OPEN_STATUSES,
  CHECK_LIMITATION,
  DOC_STATUS,
  LIFECYCLE,
  ROLE,
  humanize,
} from "@/lib/constants";
import { deriveMaturity, formatDate, formatDateTime, formatRelativeDays } from "@/lib/dates";
import { getToday } from "@/lib/demo-clock";
import { formatMoney } from "@/lib/money";
import { LIFECYCLE_LABEL, VERIFICATION_LABEL, verificationCaption } from "@/lib/instrument-meta";
import { replacementEligible } from "@/lib/services/replacements";
import { ApiForm } from "@/components/ApiForm";
import {
  CasesCard,
  DocumentsCard,
  EndorsementCard,
  FindingsCard,
  TimelineCard,
  VerificationCard,
} from "@/components/InstrumentPanels";
import { getEndorsement } from "@/lib/services/endorsements";
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  DefinitionList,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/ui";

const HOLDING_STATES = [LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED];

export default async function InstrumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const instrument = await loadInstrumentPage(user, id);
  const today = await getToday();

  const latestDocument = instrument.documents[0] ?? null;
  const latestRun = latestDocument
    ? await prisma.extractionRun.findFirst({
        where: { documentId: latestDocument.id },
        orderBy: { startedAt: "desc" },
        include: { fields: true },
      })
    : null;
  const activeRules = await prisma.ruleVersion.count({ where: { status: "ACTIVE" } });
  const endorsement = await getEndorsement(instrument.id);

  const historyUserIds = [...new Set(instrument.history.map((item) => item.changedBy))];
  const historyUsers = await prisma.user.findMany({
    where: { id: { in: historyUserIds } },
    select: { id: true, name: true },
  });
  const userNames = new Map(historyUsers.map((item) => [item.id, item.name]));

  const maturity = deriveMaturity(instrument.maturityDate, today);
  const isOwnerAdmin =
    user.role === ROLE.INSTITUTION_ADMIN && instrument.institutionId === user.institutionId;
  const isEditable = HOLDING_STATES.includes(instrument.lifecycleStatus as never);
  const canSubmit = isOwnerAdmin && isEditable && instrument.documentStatus === DOC_STATUS.CONFIRMED;
  const openBlocking = instrument.findings.filter(
    (finding) =>
      finding.severity === "CRITICAL" &&
      ["OPEN", "CORRECTION_REQUESTED"].includes(finding.resolutionStatus),
  );
  const openFindings = instrument.findings.filter((finding) =>
    ["OPEN", "CORRECTION_REQUESTED"].includes(finding.resolutionStatus),
  );
  const approvedCase = instrument.releaseCases.find((item) => item.status === "APPROVED");
  const openCaseCount = instrument.releaseCases.filter((item) =>
    CASE_OPEN_STATUSES.includes(item.status as never),
  ).length;
  const canReplace =
    isOwnerAdmin && replacementEligible(instrument.lifecycleStatus, instrument.replacedBy.length);

  return (
    <>
      <header className="instrument-head">
        <div>
          <div className="eyebrow">
            {instrument.institution.name} · {instrument.institution.aicteRef}
          </div>
          <h1 className="instrument-ref" style={{ marginTop: 12 }}>
            {instrument.fdrNumber}
          </h1>
          <div className="instrument-head__amount">{formatMoney(instrument.amount)}</div>
          <div className="instrument-head__meta">
            <span>{instrument.bankName}{instrument.branch ? ` · ${instrument.branch}` : ""}</span>
            <span>Holder: {instrument.holderName}</span>
            <span>
              {formatDate(instrument.issueDate)} → {formatDate(instrument.maturityDate)}
            </span>
            <span className="mono">v{instrument.versionNo}</span>
          </div>
          <div className="badge-row" style={{ marginTop: 14 }}>
            <StatusBadge
              value={instrument.lifecycleStatus}
              label={LIFECYCLE_LABEL[instrument.lifecycleStatus]}
            />
            <StatusBadge
              value={instrument.verificationStatus}
              label={VERIFICATION_LABEL[instrument.verificationStatus]}
            />
            <StatusBadge value={instrument.complianceStatus} />
            {instrument.verificationStatus === "SIMULATED_RESULT" ? (
              <Badge tone="simulated">Simulation only</Badge>
            ) : null}
            {instrument.findings.length > 0 ? (
              <Badge tone={openBlocking.length > 0 ? "critical" : "attention"}>
                {instrument.findings.length} finding(s)
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="instrument-head__right">
          <div className={`maturity-rail maturity-rail--${maturity.bucket === "MATURED" ? "critical" : maturity.bucket === "MATURING" ? "attention" : "neutral"}`}>
            <div className="tag">Maturity · date-derived</div>
            <div className="maturity-rail__value">{formatDate(instrument.maturityDate)}</div>
            <div className="tiny muted">
              {maturity.label} ({formatRelativeDays(maturity.days)})
            </div>
          </div>

          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
            <Link href="/instruments" className="btn btn--ghost btn--small">Register</Link>
            {isOwnerAdmin && isEditable ? (
              <Link href={`/instruments/${instrument.id}/edit`} className="btn btn--ghost btn--small">
                Edit record
              </Link>
            ) : null}
            {user.role === ROLE.SCRUTINY_OFFICER && instrument.lifecycleStatus === LIFECYCLE.SUBMITTED ? (
              <ApiForm
                action={`/api/instruments/${instrument.id}/claim`}
                submitLabel="Take into review"
                successMessage="Record taken into scrutiny."
                confirmText="Take this submitted record into scrutiny?"
                className=""
                buttonClassName="btn btn--small"
              />
            ) : null}
            {isOwnerAdmin && isEditable ? (
              <ApiForm
                action={`/api/instruments/${instrument.id}/submit`}
                submitLabel="Submit for scrutiny"
                successMessage="Submitted. Deterministic checks ran and findings were recorded."
                confirmText="Submit this record for scrutiny? Consistency checks will run."
                className=""
                buttonClassName="btn btn--small"
                disabled={!canSubmit}
              />
            ) : null}
            {canReplace ? (
              <Link href={`/instruments/${instrument.id}/replace`} className="btn btn--ghost btn--small">
                Renew / replace
              </Link>
            ) : null}
          </div>
          {isOwnerAdmin && isEditable && !canSubmit ? (
            <div className="tiny muted" style={{ maxWidth: 260, textAlign: "right" }}>
              Upload a document and confirm its extracted fields before submitting.
            </div>
          ) : null}
        </div>
      </header>

      {openBlocking.length > 0 ? (
        <div style={{ marginBottom: 22 }}>
          <Notice tone="danger" title="Critical findings block ordinary verification">
            {openBlocking.length} critical finding(s) need correction or an authorized override.
            Checks compare consistency only; they do not establish that the FDR is genuine.
          </Notice>
        </div>
      ) : (
        <div style={{ marginBottom: 22 }}>
          <Notice tone="quiet" title="Status, stated plainly">
            {verificationCaption(instrument.verificationStatus)} {CHECK_LIMITATION}
          </Notice>
        </div>
      )}

      <div className="split">
        <div className="stack">
          <Card>
            <CardHead
              title="Record"
              description="Institution-submitted values, separate from any independent source or authorized decision."
              action={<Badge tone="muted">Version {instrument.versionNo}</Badge>}
            />
            <CardBody>
              <DefinitionList
                items={[
                  { label: "Bank", value: `${instrument.bankName}${instrument.branch ? ` · ${instrument.branch}` : ""}` },
                  { label: "FDR number", value: <span className="mono">{instrument.fdrNumber}</span> },
                  { label: "Amount", value: formatMoney(instrument.amount) },
                  { label: "Currency", value: instrument.currency },
                  { label: "Issue date", value: formatDate(instrument.issueDate) },
                  { label: "Maturity date", value: `${formatDate(instrument.maturityDate)} (${maturity.label})` },
                  { label: "Primary holder", value: instrument.holderName },
                  { label: "IFSC (format-validated)", value: instrument.ifscCode ?? "—" },
                  {
                    label: "Lien declared",
                    value: (
                      <span>
                        {humanize(instrument.declaredLienStatus)}{" "}
                        <span className="tiny muted">— declaration only, not bank-confirmed</span>
                      </span>
                    ),
                  },
                  { label: "Institution", value: `${instrument.institution.name} (${instrument.institution.aicteRef})` },
                  { label: "Created", value: formatDateTime(instrument.createdAt) },
                  { label: "Last change", value: formatDateTime(instrument.updatedAt) },
                ]}
              />
              {isOwnerAdmin && isEditable ? (
                <div style={{ marginTop: 16 }}>
                  <Notice tone="quiet" title="Submission readiness">
                    <div className="badge-row" style={{ marginTop: 4 }}>
                      <Badge tone={instrument.documents.length > 0 ? "good" : "critical"}>
                        {instrument.documents.length > 0 ? "Document attached" : "Document missing"}
                      </Badge>
                      <Badge tone={instrument.documentStatus === DOC_STATUS.CONFIRMED ? "good" : "attention"}>
                        {instrument.documentStatus === DOC_STATUS.CONFIRMED
                          ? "Fields confirmed"
                          : "Fields not confirmed"}
                      </Badge>
                      <Badge tone="muted">{activeRules} approved rule version(s)</Badge>
                    </div>
                    <div className="tiny muted" style={{ marginTop: 7 }}>
                      Regulatory amount and term checks stay disabled while no approved rule
                      version is active. Submission still runs date, name, duplicate and
                      extraction-consistency checks.
                    </div>
                  </Notice>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <DocumentsCard
            documents={instrument.documents}
            latestRun={latestRun}
            instrumentId={instrument.id}
            lifecycleStatus={instrument.lifecycleStatus}
            user={user}
          />

          <FindingsCard
            findings={instrument.findings}
            lifecycleStatus={instrument.lifecycleStatus}
            user={user}
          />

          <VerificationCard
            attempts={instrument.verificationAttempts}
            documents={instrument.documents}
            instrumentId={instrument.id}
            lifecycleStatus={instrument.lifecycleStatus}
            user={user}
            blockingCount={openBlocking.length}
          />

          <EndorsementCard
            instrumentId={instrument.id}
            holderName={instrument.holderName}
            lifecycleStatus={instrument.lifecycleStatus}
            endorsement={endorsement}
            user={user}
          />

          <CasesCard
            cases={instrument.releaseCases}
            instrumentId={instrument.id}
            lifecycleStatus={instrument.lifecycleStatus}
            user={user}
          />
        </div>

        <aside className="stack">
          <Card>
            <CardHead
              title="Replacement chain"
              description="Predecessor and successor records are linked; neither overwrites the other."
            />
            <CardBody>
              {instrument.replaces ? (
                <div style={{ marginBottom: 10 }}>
                  <div className="tag">Predecessor (replaced)</div>
                  <div className="row-between" style={{ marginTop: 4 }}>
                    <Link href={`/instruments/${instrument.replaces.id}`} className="mono" style={{ fontSize: 13 }}>
                      {instrument.replaces.fdrNumber}
                    </Link>
                    <StatusBadge value={instrument.replaces.lifecycleStatus} label={LIFECYCLE_LABEL[instrument.replaces.lifecycleStatus]} />
                  </div>
                  <div className="tiny muted">{instrument.replaces.bankName}</div>
                </div>
              ) : null}

              {instrument.replacedBy.length > 0 ? (
                <div>
                  <div className="tag">Successor record(s)</div>
                  {instrument.replacedBy.map((successor) => (
                    <div key={successor.id} style={{ marginTop: 4 }}>
                      <div className="row-between">
                        <Link href={`/instruments/${successor.id}`} className="mono" style={{ fontSize: 13 }}>
                          {successor.fdrNumber}
                        </Link>
                        <StatusBadge value={successor.lifecycleStatus} label={LIFECYCLE_LABEL[successor.lifecycleStatus]} />
                      </div>
                      <div className="tiny muted">{successor.bankName} · created {formatDate(successor.createdAt)}</div>
                      {instrument.replacementReason ? (
                        <div className="tiny muted" style={{ marginTop: 2 }}>
                          Reason: {instrument.replacementReason}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {instrument.replacedAt ? (
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                      Marked replaced {formatDateTime(instrument.replacedAt)}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!instrument.replaces && instrument.replacedBy.length === 0 ? (
                <div className="tiny muted">
                  Not part of a replacement chain. {canReplace ? "Use Renew / replace above to create a linked successor." : ""}
                </div>
              ) : null}

              {instrument.replaces || instrument.replacedBy.length > 0 ? (
                <div className="tiny muted" style={{ marginTop: 8 }}>
                  The predecessor keeps its documents, findings, verification records and audit
                  history unchanged.
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Maturity & alerts" description="Date-derived; never stored as a lifecycle state." />
            <CardBody>
              <div className={`maturity-rail maturity-rail--${maturity.bucket === "MATURED" ? "critical" : maturity.bucket === "MATURING" ? "attention" : "neutral"}`}>
                <div className="tag">{humanize(maturity.bucket)}</div>
                <div className="maturity-rail__value">{maturity.label}</div>
                <div className="tiny muted">
                  Maturity {formatDate(instrument.maturityDate)} · today {formatDate(today)}
                </div>
              </div>
              <hr className="hr" />
              <div className="tiny muted">
                Default alert windows: 90 / 60 / 30 days, plus a matured alert. They are product
                defaults, not regulatory mandates.
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <Link href="/alerts" className="btn btn--ghost btn--small">Open tracker</Link>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Trust states" description="Independent fields; none is inferred from another." />
            <CardBody>
              <DefinitionList
                tight
                items={[
                  { label: "Document", value: <StatusBadge value={instrument.documentStatus} /> },
                  { label: "Extraction", value: latestRun ? <StatusBadge value={latestRun.status} /> : "—" },
                  { label: "Verification", value: <StatusBadge value={instrument.verificationStatus} label={VERIFICATION_LABEL[instrument.verificationStatus]} /> },
                  { label: "Compliance", value: <StatusBadge value={instrument.complianceStatus} /> },
                  { label: "Open findings", value: openFindings.length },
                  { label: "Open cases", value: openCaseCount },
                ]}
              />
              <div className="tiny muted" style={{ marginTop: 10 }}>
                {instrument.verificationStatus === "SIMULATED_RESULT"
                  ? "Simulation only. Production bank-confirmation gates remain unsatisfied."
                  : "No status here proves the original document is genuine."}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title="Alerts for this record"
              description="In-app, deduplicated per threshold and recipient."
            />
            <CardBody flush>
              {instrument.alerts.length === 0 ? (
                <EmptyState
                  title="No alerts generated"
                  description="Run the maturity scan to evaluate the current demo clock."
                />
              ) : (
                <ul className="list-clean">
                  {instrument.alerts.slice(0, 5).map((alert) => (
                    <li key={alert.id} style={{ padding: "11px 18px", borderBottom: "1px solid var(--line)" }}>
                      <div className="row-between">
                        <Badge tone={alert.thresholdDays === 0 ? "critical" : "attention"}>
                          {alert.thresholdDays === 0 ? "Matured" : `${alert.thresholdDays}-day`}
                        </Badge>
                        <StatusBadge value={alert.ackAt ? "ACKNOWLEDGED" : alert.status} />
                      </div>
                      <div className="tiny muted" style={{ marginTop: 4 }}>
                        Sent {formatDate(alert.sentAt)}
                        {alert.ackAt ? ` · acknowledged ${formatDate(alert.ackAt)}` : ""}
                      </div>
                      {!alert.ackAt &&
                      ([
                        ROLE.INSTITUTION_ADMIN,
                        ROLE.INSTITUTION_VIEWER,
                        ROLE.SCRUTINY_OFFICER,
                      ] as string[]).includes(user.role) ? (
                        <div style={{ marginTop: 6 }}>
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
            </CardBody>
          </Card>

          {user.role === ROLE.COMPETENT_AUTHORITY && approvedCase && instrument.lifecycleStatus === LIFECYCLE.ACTIVE ? (
            <Card>
              <CardHead
                title="Close instrument"
                description="An approved case exists. Closure is a separate administrative record."
              />
              <CardBody>
                <Notice tone="danger" title={CASE_DISCLAIMER}>
                  Closing here does not send a bank instruction or prove funds moved. Record the
                  external closure evidence separately.
                </Notice>
                <div style={{ marginTop: 12 }}>
                  <ApiForm
                    action={`/api/instruments/${instrument.id}/close`}
                    submitLabel="Record closure"
                    successMessage="Instrument closed. The bank instruction remains external."
                    confirmText="Close this instrument? This records an administrative closure only."
                  >
                    <div className="field">
                      <label htmlFor="close-reason">Closure reason and external evidence reference</label>
                      <textarea id="close-reason" name="reason" required minLength={10} maxLength={1000} />
                    </div>
                  </ApiForm>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {instrument.lifecycleStatus === LIFECYCLE.CLOSED ? (
            <Notice tone="quiet" title="Closed record">
              Closure is an administrative record. No bank instruction or fund movement is
              asserted.
            </Notice>
          ) : null}

          <TimelineCard history={instrument.history} userNames={userNames} />
        </aside>
      </div>
    </>
  );
}
