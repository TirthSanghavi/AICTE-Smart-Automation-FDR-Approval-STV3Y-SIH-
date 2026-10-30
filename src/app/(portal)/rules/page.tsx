import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ROLE, humanize } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { CHECKLIST_LABEL, CHECKLIST_VERSION, checklistFor } from "@/lib/rules/checklist";
import { SOURCE_TITLE } from "@/lib/rules/rule-register";
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

const CHECKS = [
  { id: "DR-01", check: "Mandatory field missing", severity: "High", state: "Enforced at validation" },
  { id: "DR-02", check: "Amount ≤ 0 or non-numeric", severity: "High", state: "Implemented" },
  { id: "DR-03", check: "Maturity ≤ issue date", severity: "Critical", state: "Implemented" },
  { id: "DR-04", check: "Maturity already passed at submission", severity: "High", state: "Implemented" },
  { id: "DR-05", check: "Holder differs from registered institution name", severity: "High", state: "Implemented (fuzzy)" },
  { id: "DR-06", check: "Duplicate bank + FDR number", severity: "Critical", state: "Implemented — review finding" },
  { id: "DR-07", check: "Extracted vs confirmed value differs", severity: "Info", state: "Implemented" },
  { id: "DR-08", check: "Amount differs from approved rule amount", severity: "Medium", state: "Disabled — no approved rule" },
  { id: "DR-09", check: "Term differs from approved rule term", severity: "Medium", state: "Disabled — no approved rule" },
  { id: "DR-10", check: "Low mock-extraction confidence", severity: "Info", state: "Implemented" },
  { id: "DR-11", check: "Independent source conflicts with record", severity: "Critical", state: "Implemented when recorded" },
];

export default async function RulesPage() {
  const user = await requireUser();
  if (user.role === ROLE.SERVICE_ACCOUNT) redirect("/");

  const ruleSets = await prisma.ruleSet.findMany({
    include: { versions: { orderBy: { version: "desc" } } },
    orderBy: { code: "asc" },
  });
  const pending = ruleSets.reduce(
    (count, set) => count + set.versions.filter((version) => version.status !== "ACTIVE").length,
    0,
  );
  const active = ruleSets.reduce(
    (count, set) => count + set.versions.filter((version) => version.status === "ACTIVE").length,
    0,
  );
  const estimate = checklistFor("RELEASE");

  return (
    <>
      <PageHead
        eyebrow="Source & rule register"
        title="No source, no rule."
        description="Every rule must carry a citation, clause, page, applicability, effective dates, interpretation and approver before it can become authoritative. In this prototype no rule version is approved."
        actions={<Link href="/instruments" className="btn btn--ghost">Records</Link>}
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Source sets" value={ruleSets.length} detail="Mapped from the public handbook" />
          <Stat label="Pending versions" value={pending} href="/rules" detail="PENDING_CONFIRMATION" attention={pending > 0} />
          <Stat label="Active approved rules" value={active} detail="Required for automated amount/term checks" />
          <Stat label="Illustrative checklist" value={estimate.length} detail="Release template steps" />
        </div>

        <Notice tone="danger" title="Regulatory status">
          The public Approval Process Handbook is mapped, but applicability, current edition and
          later amendments are not confirmed. No rule below is applied as authority. When no
          approved rule exists, the safe outcome is REVIEW_REQUIRED — never a guessed amount, term
          or legal outcome.
        </Notice>

        <Card>
          <CardHead
            title="Rule versions"
            description={SOURCE_TITLE}
            action={<Badge tone="muted">{ruleSets.length} rule set(s)</Badge>}
          />
          <CardBody flush>
            {ruleSets.length === 0 ? (
              <EmptyState title="No rule sets seeded" />
            ) : (
              <div>
                {ruleSets.map((set) => {
                  const version = set.versions[0];
                  return (
                    <article key={set.id} className="finding">
                      <div className="finding__top">
                        <div className="badge-row">
                          <Badge tone="neutral">{set.code}</Badge>
                          {version ? <StatusBadge value={version.status} /> : null}
                          <span className="finding__rule">v{version?.version ?? "—"}</span>
                        </div>
                        <span className="tiny muted">
                          {version?.effectiveFrom
                            ? `Effective ${formatDate(version.effectiveFrom)}`
                            : "No confirmed effective date"}
                        </span>
                      </div>
                      <div className="finding__title">{set.title}</div>
                      <div className="finding__text">{set.description}</div>
                      {version ? (
                        <>
                          <div className="finding__basis">
                            Source: {version.sourceRef} · {version.clause} · {version.page}
                          </div>
                          <div className="small" style={{ marginTop: 6 }}>
                            <strong>Interpretation:</strong> {version.interpretation}
                          </div>
                          <div className="small muted" style={{ marginTop: 3 }}>
                            <strong>Applicability:</strong> {version.applicability}
                          </div>
                          <div className="finding__action">
                            Approver: {version.approvedBy ?? "None"} ·{" "}
                            {version.approvedAt
                              ? `approved ${formatDate(version.approvedAt)}`
                              : "not approved for use"}
                          </div>
                        </>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </CardBody>
          <div className="card__foot">
            <span>
              Rule publication would require two-person approval with source metadata and test
              results. This build exposes no publishing control.
            </span>
          </div>
        </Card>

        <div className="split">
          <Card>
            <CardHead
              title="Deterministic checks"
              description="Consistency checks explain findings. They do not establish authenticity, and no check marks a record bank-confirmed."
            />
            <CardBody flush>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Check</th>
                      <th>Severity</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CHECKS.map((check) => (
                      <tr key={check.id}>
                        <td className="mono tiny">{check.id}</td>
                        <td>{check.check}</td>
                        <td>
                          <Badge tone={check.severity === "Critical" ? "critical" : check.severity === "High" ? "attention" : "muted"}>
                            {check.severity}
                          </Badge>
                        </td>
                        <td className="tiny muted">{check.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
            <div className="card__foot">
              <span>Confidence is not a fraud score; findings are not verdicts.</span>
            </div>
          </Card>

          <div className="stack">
            <Card>
              <CardHead
                title="Release checklist template"
                description={CHECKLIST_LABEL}
                action={<Badge tone="muted">{CHECKLIST_VERSION}</Badge>}
              />
              <CardBody>
                <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
                  {estimate.map((task) => (
                    <li key={task.stepOrder} style={{ marginBottom: 8 }}>
                      <strong>{task.title}</strong>
                      <div className="tiny muted">
                        {task.role.replaceAll("_", " ").toLowerCase()} · {task.required ? "required" : "optional"}
                      </div>
                    </li>
                  ))}
                </ol>
              </CardBody>
              <div className="card__foot">
                <span>Not an official sequence. Source: PDR / Clause 6.46 mapping, unconfirmed.</span>
              </div>
            </Card>

            <Card>
              <CardHead title="Source register" description="What this prototype relies on." />
              <CardBody>
                <div className="small" style={{ display: "grid", gap: 10 }}>
                  <div>
                    <span className="tag">SRC-001</span> SIH problem statement — requirements only,
                    no regulatory detail.
                  </div>
                  <div>
                    <span className="tag">SRC-002</span> Team notes — unverified observations and
                    checklist ideas.
                  </div>
                  <div>
                    <span className="tag">SRC-003</span> AICTE Approval Process Handbook 2024–2027
                    — Clause 1.12 / Table 1.4 (p. 10) and Clause 6.46 (pp. 61–62). Public copy
                    reviewed; sign-off pending.
                  </div>
                  <div>
                    <span className="tag">SRC-004</span> Later circulars, amendments and
                    case-specific approvals — not yet verified.
                  </div>
                </div>
                <div className="tiny muted" style={{ marginTop: 12 }}>
                  A source mapping is not legal sign-off. Applicability, edition and amendments
                  require authorized validation.
                </div>
              </CardBody>
            </Card>
          </div>
        </div>

        <Notice tone="quiet" title="What the engine does when a rule is missing">
          The record proceeds through evidence and human review, but no automated amount or term
          conclusion is shown. The compliance chip reads {humanize("RULES_PENDING")} and the case
          template remains illustrative. This is intentional, not a missing feature.
        </Notice>
      </div>
    </>
  );
}
