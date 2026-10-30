import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { caseScope } from "@/lib/rbac";
import {
  CASE_OPEN_STATUSES,
  CASE_TYPE_LABEL,
  CHECK_LIMITATION,
} from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { checklistSatisfied } from "@/lib/rules/checklist";
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Notice,
  PageHead,
  StatusBadge,
} from "@/components/ui";

const FILTERS = [
  { key: "open", label: "Open", statuses: CASE_OPEN_STATUSES },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
  { key: "all", label: "All", statuses: [] },
] as const;

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filterKey = params.filter ?? "open";
  const filter = FILTERS.find((item) => item.key === filterKey) ?? FILTERS[0];

  const cases = await prisma.releaseCase.findMany({
    where: {
      AND: [
        caseScope(user),
        filter.statuses.length > 0
          ? { status: { in: filter.statuses as unknown as string[] } }
          : {},
      ],
    },
    include: {
      instrument: true,
      institution: true,
      tasks: { orderBy: { stepOrder: "asc" } },
      decisions: { orderBy: { decidedAt: "desc" }, take: 1 },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 100,
  });

  const pendingDecision = cases.filter((item) =>
    CASE_OPEN_STATUSES.includes(item.status as never),
  ).length;

  return (
    <>
      <PageHead
        eyebrow="Case workspace"
        title="Release, refund and extension decisions."
        description="A case records an administrative workflow. It does not rewrite the instrument lifecycle, issue a bank instruction, confirm lien status, or move funds."
        actions={<Link href="/instruments" className="btn btn--ghost">Records</Link>}
      />

      <div className="filter-bar" aria-label="Case filters">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={`/cases?filter=${item.key}`}
            className={`filter-chip${filter.key === item.key ? " filter-chip--active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
        <span className="tiny muted" style={{ marginLeft: 6 }}>
          {cases.length} case(s)
        </span>
      </div>

      <div className="stack">
        <Notice tone="quiet" title="Illustrative workflow">
          The seeded checklist is labelled “ILLUSTRATIVE SAMPLE — not an official AICTE
          sequence”. {CHECK_LIMITATION} Case templates are not a substitute for approved
          regulatory rules.
        </Notice>

        <Card>
          <CardHead
            title={filter.key === "open" ? "Open cases" : "Cases in view"}
            description={
              filter.key === "open"
                ? `${pendingDecision} case(s) still need checklist or decision work.`
                : "Filtered by case status."
            }
            action={<Badge tone="muted">{user.role.replaceAll("_", " ").toLowerCase()}</Badge>}
          />
          <CardBody flush>
            {cases.length === 0 ? (
              <EmptyState
                title="No cases here"
                description="Institution admins can open a case from an active FDR record. Reviewers see only cases with tasks assigned to their role."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Case / record</th>
                      <th>Institution</th>
                      <th>Type</th>
                      <th>Checklist</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((item) => {
                      const required = item.tasks.filter((task) => task.required);
                      const satisfied = required.filter(
                        (task) => task.status === "COMPLETED" && task.outcome === "SATISFIED",
                      ).length;
                      const checklist = checklistSatisfied(item.tasks);
                      const lastDecision = item.decisions[0];
                      return (
                        <tr key={item.id}>
                          <td>
                            <Link href={`/cases/${item.id}`} className="data-table__primary mono">
                              {item.instrument.fdrNumber}
                            </Link>
                            <div className="data-table__sub">
                              {formatMoney(item.instrument.amount)} · {item.reason.slice(0, 70)}
                              {item.reason.length > 70 ? "…" : ""}
                            </div>
                          </td>
                          <td>
                            <div>{item.institution.name}</div>
                            <div className="data-table__sub mono">{item.institution.aicteRef}</div>
                          </td>
                          <td>{CASE_TYPE_LABEL[item.type] ?? item.type}</td>
                          <td>
                            <div className="mono" style={{ fontSize: 11 }}>
                              {satisfied}/{required.length}
                            </div>
                            <div className="data-table__sub">
                              {checklist.complete ? "All required satisfied" : "Incomplete"}
                            </div>
                          </td>
                          <td>
                            <StatusBadge value={item.status} />
                            {lastDecision ? (
                              <div className="data-table__sub">
                                {formatDate(lastDecision.decidedAt)}
                              </div>
                            ) : null}
                          </td>
                          <td className="nowrap">{formatDate(item.updatedAt)}</td>
                          <td>
                            <Link href={`/cases/${item.id}`} className="btn btn--ghost btn--small">
                              Open
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
          <div className="card__foot">
            <span>Case status is independent of instrument lifecycle.</span>
            <Link href="/rules" className="tiny mono">Why templates are illustrative →</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
