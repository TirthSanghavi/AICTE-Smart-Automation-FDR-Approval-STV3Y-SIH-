import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ROLE } from "@/lib/constants";
import { listInstitutions, type InstitutionSort } from "@/lib/services/institutions";
import { Card, CardBody, EmptyState, PageHead } from "@/components/ui";

type Search = {
  q?: string;
  category?: string;
  state?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
  dir?: string;
};

const COLUMNS: { key: InstitutionSort; label: string }[] = [
  { key: "name", label: "Institution" },
  { key: "aicteRef", label: "Code" },
  { key: "state", label: "State / city" },
  { key: "category", label: "Category" },
];

function buildHref(params: Search, patch: Partial<Search>) {
  const merged = { ...params, ...patch };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (!value) continue;
    if (key === "page" && value === "1") continue;
    if (key === "pageSize" && value === "10") continue;
    if (key === "sort" && value === "name") continue;
    if (key === "dir" && value === "asc") continue;
    query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `/institutions?${suffix}` : "/institutions";
}

export default async function InstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const activeFilters = [params.q, params.category, params.state].filter(Boolean).length;

  const result = await listInstitutions(user, {
    q: params.q,
    category: params.category,
    state: params.state,
    page: Number(params.page) || 1,
    pageSize: Number(params.pageSize) || 10,
    sort: params.sort,
    dir: params.dir,
  });

  const canEdit = user.role === ROLE.SYSTEM_ADMIN;
  const scopedToSelf = !!user.institutionId;

  return (
    <>
      <PageHead
        eyebrow="Institution directory"
        title="Every institution, with live numbers."
        description={
          scopedToSelf
            ? "Your session scope limits the directory to your own institution. Statistics are computed from the records, never hardcoded."
            : "Statistics are computed from the underlying FDR records. Active exposure excludes replaced and released instruments so a predecessor and its successor are never double-counted."
        }
      />

      <form method="get" action="/institutions" className="filter-bar" aria-label="Directory filters">
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search name, code or city"
          aria-label="Search institutions"
          style={{ maxWidth: 300 }}
        />
        <select name="category" defaultValue={params.category ?? ""} aria-label="Filter by category" style={{ maxWidth: 200 }}>
          <option value="">All categories</option>
          {result.facets.categories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        <select name="state" defaultValue={params.state ?? ""} aria-label="Filter by state" style={{ maxWidth: 200 }}>
          <option value="">All states</option>
          {result.facets.states.map((state) => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
        <button type="submit" className="btn btn--ghost btn--small">Apply filters</button>
        {activeFilters > 0 ? (
          <Link href="/institutions" className="filter-chip">
            Clear {activeFilters} filter(s)
          </Link>
        ) : null}
        <span className="tiny muted">
          {result.total} institution(s) · page {result.page} of {result.pageCount}
        </span>
        <input type="hidden" name="sort" value={params.sort ?? "name"} />
        <input type="hidden" name="dir" value={params.dir ?? "asc"} />
      </form>

      <Card>
        <CardBody flush>
          {result.rows.length === 0 ? (
            <EmptyState
              title="No institutions match"
              description="Adjust the search or filters. The directory reads directly from the database, so an empty result means no records exist for this scope."
              action={activeFilters > 0 ? <Link href="/institutions" className="btn">Clear filters</Link> : undefined}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {COLUMNS.map((column) => {
                      const isActive = (params.sort ?? "name") === column.key;
                      const nextDir = isActive && (params.dir ?? "asc") === "asc" ? "desc" : "asc";
                      return (
                        <th key={column.key} aria-sort={isActive ? ((params.dir ?? "asc") === "asc" ? "ascending" : "descending") : "none"}>
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
                    <th>FDR records</th>
                    <th>Users</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((institution) => (
                    <tr key={institution.id}>
                      <td>
                        <Link href={`/institutions/${institution.id}`} className="data-table__primary">
                          {institution.name}
                        </Link>
                        <div className="data-table__sub">{institution.city ?? "—"}</div>
                      </td>
                      <td className="mono">{institution.aicteRef}</td>
                      <td>{institution.state}</td>
                      <td>{institution.category}</td>
                      <td>{institution._count.instruments}</td>
                      <td>{institution._count.users}</td>
                      <td>
                        <Link href={`/institutions/${institution.id}`} className="btn btn--ghost btn--small">
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
        {result.rows.length > 0 ? (
          <div className="card__foot">
            <span className="tiny muted">
              Showing {result.rows.length} of {result.total}
              {canEdit ? " · you can edit profiles (System Admin)" : ""}
            </span>
            <span className="btn-row">
              {result.page > 1 ? (
                <Link href={buildHref(params, { page: String(result.page - 1) })} className="btn btn--ghost btn--small">
                  Previous
                </Link>
              ) : null}
              <span className="tiny muted">Page {result.page} / {result.pageCount}</span>
              {result.page < result.pageCount ? (
                <Link href={buildHref(params, { page: String(result.page + 1) })} className="btn btn--ghost btn--small">
                  Next
                </Link>
              ) : null}
              <form method="get" action="/institutions" className="btn-row" style={{ display: "inline-flex" }}>
                {(["q", "category", "state", "sort", "dir", "page"] as const).map((key) =>
                  params[key] ? <input key={key} type="hidden" name={key} value={params[key]!} /> : null,
                )}
                <label className="tiny muted" htmlFor="pageSize">Per page</label>
                <select id="pageSize" name="pageSize" defaultValue={params.pageSize ?? "10"} aria-label="Records per page">
                  {[10, 25, 50].map((size) => (
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
