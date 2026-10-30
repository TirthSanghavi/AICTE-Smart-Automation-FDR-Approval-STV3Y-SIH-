import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { INSTITUTION_ROLES, LIFECYCLE, humanize } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import {
  REPORTS,
  REPORT_IDS,
  runReport,
  type ReportFilters,
} from "@/lib/services/reports";
import { Card, CardBody, EmptyState, Notice, PageHead } from "@/components/ui";

type Search = {
  report?: string;
  institutionId?: string;
  bank?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
  dir?: string;
};

const CASE_STATUSES = [
  "OPEN",
  "IN_REVIEW",
  "RETURNED",
  "ESCALATED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "CLOSED",
];

function buildHref(params: Search, patch: Partial<Search>) {
  const merged = { ...params, ...patch };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (!value) continue;
    if (key === "page" && value === "1") continue;
    if (key === "report" && value === "institution-exposure") continue;
    if (key === "pageSize" && value === "25") continue;
    if (key === "sort" && !value) continue;
    if (key === "dir" && value === "asc") continue;
    query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `/reports?${suffix}` : "/reports";
}

function exportHref(params: Search) {
  const query = new URLSearchParams();
  query.set("report", params.report ?? "institution-exposure");
  for (const key of ["institutionId", "bank", "status", "from", "to"] as const) {
    if (params[key]) query.set(key, params[key]!);
  }
  return `/api/reports/export?${query.toString()}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const reportId = REPORT_IDS.includes(params.report ?? "")
    ? (params.report as string)
    : "institution-exposure";
  const scopedToSelf = INSTITUTION_ROLES.includes(user.role);
  const institutions = scopedToSelf
    ? []
    : await prisma.institution.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

  const filters: ReportFilters = {
    institutionId: params.institutionId,
    bank: params.bank,
    status: params.status,
    from: params.from,
    to: params.to,
  };
  const activeFilters = [
    scopedToSelf ? null : params.institutionId,
    params.bank,
    params.status,
    params.from,
    params.to,
  ].filter(Boolean).length;

  const report = await runReport(reportId, user, filters, {
    page: Number(params.page) || 1,
    pageSize: Number(params.pageSize) || 25,
    sort: params.sort,
    dir: params.dir,
  });

  const statusOptions =
    report.statusFilterKind === "case"
      ? CASE_STATUSES
      : report.statusFilterKind === "lifecycle"
        ? Object.values(LIFECYCLE)
        : [];

  return (
    <>
      <PageHead
        eyebrow="Reports & data export"
        title="Reconciled numbers, exportable as CSV."
        description="Every figure is computed from the database under your role's scope — institution sessions are pinned to their own tenant even when the endpoint is called directly. Filters apply to both the table and the exported file."
        actions={<a href={exportHref(params)} className="btn">Export CSV</a>}
      />

      <div className="filter-bar" aria-label="Report selection">
        {REPORT_IDS.map((id) => (
          <Link
            key={id}
            href={buildHref(params, { report: id, page: "1" })}
            className={`filter-chip${reportId === id ? " filter-chip--active" : ""}`}
          >
            {REPORTS[id].title}
          </Link>
        ))}
      </div>

      <form method="get" action="/reports" className="filter-bar" aria-label="Report filters">
        <input type="hidden" name="report" value={reportId} />
        {!scopedToSelf && institutions.length > 0 ? (
          <select name="institutionId" defaultValue={params.institutionId ?? ""} aria-label="Filter by institution">
            <option value="">All institutions</option>
            {institutions.map((institution) => (
              <option key={institution.id} value={institution.id}>{institution.name}</option>
            ))}
          </select>
        ) : null}
        <input
          type="text"
          name="bank"
          defaultValue={params.bank ?? ""}
          placeholder="Bank contains…"
          aria-label="Filter by bank"
          style={{ maxWidth: 200 }}
        />
        {statusOptions.length > 0 ? (
          <select name="status" defaultValue={params.status ?? ""} aria-label="Filter by status">
            <option value="">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>{humanize(status)}</option>
            ))}
          </select>
        ) : null}
        <label className="tiny muted" htmlFor="from">Maturity from</label>
        <input id="from" type="date" name="from" defaultValue={params.from ?? ""} style={{ maxWidth: 180 }} />
        <label className="tiny muted" htmlFor="to">to</label>
        <input id="to" type="date" name="to" defaultValue={params.to ?? ""} style={{ maxWidth: 180 }} />
        <button type="submit" className="btn btn--ghost btn--small">Apply filters</button>
        {activeFilters > 0 ? (
          <Link href={`/reports?report=${reportId}`} className="filter-chip">
            Clear {activeFilters} filter(s)
          </Link>
        ) : null}
        <span className="tiny muted">{report.total} row(s) in view</span>
      </form>

      <Card>
        <CardBody flush>
          {report.rows.length === 0 ? (
            <EmptyState
              title="Nothing to report yet"
              description="No records match this report and filter combination. Records appear here after instruments are created and submitted under your scope."
              action={activeFilters > 0 ? <Link href={`/reports?report=${reportId}`} className="btn">Clear filters</Link> : undefined}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {report.columns.map((column) => {
                      const numeric = column.numeric || column.money;
                      if (!report.sortable) {
                        return (
                          <th key={column.key} className={numeric ? "amount" : undefined}>
                            {column.label}
                          </th>
                        );
                      }
                      const isActive = params.sort === column.key;
                      const nextDir = isActive && (params.dir ?? "asc") === "asc" ? "desc" : "asc";
                      return (
                        <th
                          key={column.key}
                          className={numeric ? "amount" : undefined}
                          aria-sort={isActive ? ((params.dir ?? "asc") === "asc" ? "ascending" : "descending") : "none"}
                        >
                          <Link
                            href={buildHref(params, { sort: column.key, dir: nextDir, page: "1" })}
                            className="data-table__sort"
                          >
                            {column.label}
                            <span aria-hidden="true">{isActive ? ((params.dir ?? "asc") === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
                          </Link>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, index) => (
                    <tr key={index}>
                      {report.columns.map((column) => {
                        const raw = row[column.key];
                        const value =
                          column.money && typeof raw === "number"
                            ? formatMoney(raw)
                            : raw === null || raw === undefined
                              ? "—"
                              : String(raw);
                        return (
                          <td
                            key={column.key}
                            className={
                              column.money || column.numeric
                                ? "amount"
                                : undefined
                            }
                          >
                            {column.key === "fdrNumber" && typeof raw === "string" ? (
                              <span className="mono">{value}</span>
                            ) : (
                              value
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(report.totals).length > 0 ? (
                  <tfoot>
                    <tr>
                      <td colSpan={Math.max(1, report.columns.length - 1)}>
                        <span className="tiny muted">Totals (this page / report)</span>
                      </td>
                      {report.columns.length > 0 &&
                      report.columns[report.columns.length - 1].money ? (
                        <td className="amount">
                          {Object.entries(report.totals)
                            .filter(([key]) => report.columns[report.columns.length - 1].key === key)
                            .map(([, value]) => formatMoney(value))[0] ?? ""}
                        </td>
                      ) : null}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
        </CardBody>
        {report.pageCount > 1 ? (
          <div className="card__foot">
            <span className="tiny muted">
              Page {report.page} of {report.pageCount} · {report.total} total row(s)
            </span>
            <span className="btn-row">
              {report.page > 1 ? (
                <Link href={buildHref(params, { page: String(report.page - 1) })} className="btn btn--ghost btn--small">Previous</Link>
              ) : null}
              {report.page < report.pageCount ? (
                <Link href={buildHref(params, { page: String(report.page + 1) })} className="btn btn--ghost btn--small">Next</Link>
              ) : null}
            </span>
          </div>
        ) : null}
      </Card>

      <Notice tone="quiet" title={`How to read “${report.title}”`}>
        {report.definition} Exports honour the same filters and authorization as this table.
      </Notice>
    </>
  );
}
