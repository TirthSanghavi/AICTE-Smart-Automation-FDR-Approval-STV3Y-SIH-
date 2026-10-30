import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { instrumentScope } from "@/lib/rbac";
import { INSTITUTION_ROLES, LIFECYCLE, ROLE, humanize } from "@/lib/constants";
import { addDays, deriveMaturity, formatDate } from "@/lib/dates";
import { getToday } from "@/lib/demo-clock";
import { formatMoney } from "@/lib/money";
import { LIFECYCLE_LABEL, VERIFICATION_LABEL } from "@/lib/instrument-meta";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHead,
  StatusBadge,
} from "@/components/ui";

const STATUS_FILTERS = [
  "ALL",
  LIFECYCLE.DRAFT,
  LIFECYCLE.SUBMITTED,
  LIFECYCLE.UNDER_REVIEW,
  LIFECYCLE.CORRECTION_REQUESTED,
  LIFECYCLE.ACTIVE,
  LIFECYCLE.CLOSED,
] as const;

type Search = {
  status?: string;
  q?: string;
  maturity?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
};

const SORT_FIELDS = {
  record: "fdrNumber",
  amount: "amount",
  maturity: "maturityDate",
  lifecycle: "lifecycleStatus",
  updated: "updatedAt",
} as const;
type SortKey = keyof typeof SORT_FIELDS;

function orderByFor(sort: string | undefined, dir: string | undefined): Prisma.InstrumentOrderByWithRelationInput[] {
  const known = (Object.keys(SORT_FIELDS) as string[]).includes(sort ?? "");
  const key = known ? (sort as SortKey) : "updated";
  const direction: Prisma.SortOrder = dir === "asc" ? "asc" : "desc";
  return [{ [SORT_FIELDS[key]]: known ? direction : "desc" }, { id: "asc" }];
}

function buildHref(params: Search, patch: Partial<Search>) {
  const merged = { ...params, ...patch };
  const query = new URLSearchParams();
  if (merged.status && merged.status !== "ALL") query.set("status", merged.status);
  if (merged.q) query.set("q", merged.q);
  if (merged.maturity && merged.maturity !== "ALL") query.set("maturity", merged.maturity);
  if (merged.sort && merged.sort !== "updated") query.set("sort", merged.sort);
  if (merged.dir && merged.dir !== "desc") query.set("dir", merged.dir);
  if (merged.page && merged.page !== "1") query.set("page", merged.page);
  if (merged.pageSize && merged.pageSize !== "25") query.set("pageSize", merged.pageSize);
  const suffix = query.toString();
  return suffix ? `/instruments?${suffix}` : "/instruments";
}

export default async function InstrumentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const today = await getToday();

  const and: Prisma.InstrumentWhereInput[] = [instrumentScope(user)];
  if (params.status && params.status !== "ALL" && Object.values(LIFECYCLE).includes(params.status as never)) {
    and.push({ lifecycleStatus: params.status });
  }
  if (params.q) {
    const q = params.q.slice(0, 80);
    and.push({
      OR: [
        { fdrNumber: { contains: q } },
        { fdrNumber: { contains: q.toUpperCase() } },
        { bankName: { contains: q } },
        { holderName: { contains: q } },
      ],
    });
  }
  if (params.maturity === "maturing") {
    and.push({
      lifecycleStatus: LIFECYCLE.ACTIVE,
      maturityDate: { gte: today, lte: addDays(today, 90) },
    });
  } else if (params.maturity === "overdue") {
    and.push({ lifecycleStatus: LIFECYCLE.ACTIVE, maturityDate: { lt: today } });
  }

  const activeFilters = [
    params.status && params.status !== "ALL" ? params.status : null,
    params.q,
    params.maturity && params.maturity !== "ALL" ? params.maturity : null,
  ].filter(Boolean).length;

  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 25));
  const where: Prisma.InstrumentWhereInput = { AND: and };

  const [total, instruments] = await Promise.all([
    prisma.instrument.count({ where }),
    prisma.instrument.findMany({
      where,
      include: {
        institution: true,
        findings: {
          where: { resolutionStatus: { in: ["OPEN", "CORRECTION_REQUESTED"] } },
          select: { id: true, severity: true },
        },
        releaseCases: {
          where: { status: { in: ["OPEN", "IN_REVIEW", "RETURNED", "ESCALATED"] } },
          select: { id: true },
        },
      },
      orderBy: orderByFor(params.sort, params.dir),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentSort = (Object.keys(SORT_FIELDS) as string[]).includes(params.sort ?? "")
    ? (params.sort as SortKey)
    : "updated";
  const currentDir = params.dir === "asc" ? "asc" : "desc";

  const showInstitution = !INSTITUTION_ROLES.includes(user.role);
  const canCreate = user.role === ROLE.INSTITUTION_ADMIN;

  const sortableHeader = (key: SortKey, label: string) => {
    const isActive = currentSort === key;
    const nextDir = !isActive
      ? key === "amount"
        ? "desc"
        : "asc"
      : currentDir === "asc"
        ? "desc"
        : "asc";
    return (
      <th
        aria-sort={isActive ? (currentDir === "asc" ? "ascending" : "descending") : "none"}
      >
        <Link href={buildHref(params, { sort: key, dir: nextDir, page: "1" })} className="data-table__sort">
          {label}
          <span aria-hidden="true">{isActive ? (currentDir === "asc" ? " ▲" : " ▼") : " ⇅"}</span>
        </Link>
      </th>
    );
  };

  return (
    <>
      <PageHead
        eyebrow="Instrument register"
        title={showInstitution ? "Every FDR, one evidence trail." : "Your FDR records."}
        description="Filters, sorting and pagination run on the server. Institution scope is resolved from the authenticated session on the server, never from a request parameter."
        actions={canCreate ? <Link href="/instruments/new" className="btn">New FDR record</Link> : undefined}
      />

      <div className="filter-bar" aria-label="Status filters">
        {STATUS_FILTERS.map((status) => (
          <Link
            key={status}
            href={buildHref(params, { status })}
            className={`filter-chip${(params.status ?? "ALL") === status ? " filter-chip--active" : ""}`}
          >
            {status === "ALL" ? "All statuses" : LIFECYCLE_LABEL[status] ?? humanize(status)}
          </Link>
        ))}
        <span style={{ width: 8 }} />
        <Link
          href={buildHref(params, { maturity: "maturing" })}
          className={`filter-chip${params.maturity === "maturing" ? " filter-chip--active" : ""}`}
        >
          Maturing ≤90d
        </Link>
        <Link
          href={buildHref(params, { maturity: "overdue" })}
          className={`filter-chip${params.maturity === "overdue" ? " filter-chip--active" : ""}`}
        >
          Matured
        </Link>
        {activeFilters > 0 ? (
          <Link href="/instruments" className="filter-chip">
            Clear {activeFilters} filter(s)
          </Link>
        ) : (
          <Link href="/instruments" className="filter-chip">Reset</Link>
        )}
      </div>

      <form method="get" action="/instruments" className="filter-bar">
        {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
        {params.maturity ? <input type="hidden" name="maturity" value={params.maturity} /> : null}
        {params.sort ? <input type="hidden" name="sort" value={params.sort} /> : null}
        {params.dir ? <input type="hidden" name="dir" value={params.dir} /> : null}
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search FDR number, bank or holder"
          aria-label="Search records"
          style={{ maxWidth: 340 }}
        />
        <button type="submit" className="btn btn--ghost btn--small">Search</button>
        <span className="tiny muted">
          {total} record(s) in view · page {page} of {pageCount}
        </span>
      </form>

      <Card>
        <CardBody flush>
          {instruments.length === 0 ? (
            <EmptyState
              title={activeFilters > 0 || params.q ? "No records match" : "No records yet"}
              description={
                activeFilters > 0 || params.q
                  ? "Try a different status or filter. New records start as drafts and require a private document upload before submission."
                  : "Create your first FDR record to begin the submission flow."
              }
              action={canCreate ? <Link href="/instruments/new" className="btn">Add your first FDR</Link> : undefined}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {sortableHeader("record", "Record")}
                    {showInstitution ? <th>Institution</th> : null}
                    {sortableHeader("amount", "Amount")}
                    {sortableHeader("maturity", "Maturity")}
                    {sortableHeader("lifecycle", "Lifecycle")}
                    <th>Verification</th>
                    <th>Open items</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {instruments.map((instrument) => {
                    const maturity = deriveMaturity(instrument.maturityDate, today);
                    const critical = instrument.findings.some((f) => f.severity === "CRITICAL");
                    return (
                      <tr key={instrument.id}>
                        <td>
                          <Link href={`/instruments/${instrument.id}`} className="data-table__primary mono">
                            {instrument.fdrNumber}
                          </Link>
                          <div className="data-table__sub">{instrument.bankName}{instrument.branch ? ` · ${instrument.branch}` : ""}</div>
                        </td>
                        {showInstitution ? (
                          <td>
                            <div>{instrument.institution.name}</div>
                            <div className="data-table__sub mono">{instrument.institution.aicteRef}</div>
                          </td>
                        ) : null}
                        <td className="amount">{formatMoney(instrument.amount)}</td>
                        <td>
                          <div className="nowrap">{formatDate(instrument.maturityDate)}</div>
                          <div className="data-table__sub">
                            <Badge
                              tone={
                                maturity.bucket === "MATURED"
                                  ? "critical"
                                  : maturity.bucket === "MATURING"
                                    ? "attention"
                                    : "muted"
                              }
                            >
                              {maturity.label}
                            </Badge>
                          </div>
                        </td>
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
                          <div className="data-table__sub">
                            {instrument.verificationStatus === "SIMULATED_RESULT"
                              ? "Simulation only"
                              : instrument.verificationStatus === "MANUAL_REVIEW_RECORDED"
                                ? "Not bank-confirmed"
                                : "No independent confirmation"}
                          </div>
                        </td>
                        <td>
                          <div className="badge-row">
                            {instrument.findings.length > 0 ? (
                              <Badge tone={critical ? "critical" : "attention"}>
                                {instrument.findings.length} finding(s)
                              </Badge>
                            ) : null}
                            {instrument.releaseCases.length > 0 ? (
                              <Badge tone="attention">
                                {instrument.releaseCases.length} case(s)
                              </Badge>
                            ) : null}
                            {instrument.findings.length === 0 && instrument.releaseCases.length === 0 ? (
                              <span className="tiny muted">None</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <Link href={`/instruments/${instrument.id}`} className="btn btn--ghost btn--small">
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
        {instruments.length > 0 ? (
          <div className="card__foot">
            <span className="tiny muted">
              Showing {instruments.length} of {total} · sorted by {currentSort} ({currentDir === "asc" ? "ascending" : "descending"})
            </span>
            <span className="btn-row">
              {page > 1 ? (
                <Link href={buildHref(params, { page: String(page - 1) })} className="btn btn--ghost btn--small">
                  Previous
                </Link>
              ) : null}
              <span className="tiny muted">Page {page} / {pageCount}</span>
              {page < pageCount ? (
                <Link href={buildHref(params, { page: String(page + 1) })} className="btn btn--ghost btn--small">
                  Next
                </Link>
              ) : null}
              <form method="get" action="/instruments" className="btn-row" style={{ display: "inline-flex" }}>
                {(["status", "q", "maturity", "sort", "dir"] as const).map((key) =>
                  params[key] ? <input key={key} type="hidden" name={key} value={params[key]!} /> : null,
                )}
                <label className="tiny muted" htmlFor="inst-page-size">Per page</label>
                <select id="inst-page-size" name="pageSize" defaultValue={params.pageSize ?? "25"} aria-label="Records per page">
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={String(size)}>{size}</option>
                  ))}
                </select>
                <button type="submit" className="btn btn--ghost btn--small">Go</button>
              </form>
            </span>
          </div>
        ) : null}
      </Card>
    </>
  );
}
