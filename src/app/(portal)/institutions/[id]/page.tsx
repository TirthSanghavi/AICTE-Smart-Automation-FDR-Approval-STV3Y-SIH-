import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadInstitutionPage } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { LIFECYCLE, ROLE } from "@/lib/constants";
import { deriveMaturity, formatDate } from "@/lib/dates";
import { getToday } from "@/lib/demo-clock";
import { formatMoney } from "@/lib/money";
import { LIFECYCLE_LABEL, VERIFICATION_LABEL } from "@/lib/instrument-meta";
import {
  institutionStats,
  listInstitutionFdrs,
} from "@/lib/services/institutions";
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
  Stat,
  StatusBadge,
} from "@/components/ui";

type Search = { page?: string; pageSize?: string; status?: string };

function fdrHref(id: string, params: Search, patch: Partial<Search>) {
  const merged = { ...params, ...patch };
  const query = new URLSearchParams();
  if (merged.page && merged.page !== "1") query.set("page", merged.page);
  if (merged.pageSize && merged.pageSize !== "10") query.set("pageSize", merged.pageSize);
  if (merged.status) query.set("status", merged.status);
  const suffix = query.toString();
  return suffix ? `/institutions/${id}?${suffix}` : `/institutions/${id}`;
}

export default async function InstitutionProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const queryParams = await searchParams;
  const institution = await loadInstitutionPage(user, id);
  const today = await getToday();

  const [stats, fdrs, users] = await Promise.all([
    institutionStats(institution.id),
    listInstitutionFdrs(user, institution.id, {
      page: Number(queryParams.page) || 1,
      pageSize: Number(queryParams.pageSize) || 10,
      status: queryParams.status,
    }),
    prisma.user.findMany({
      where: { institutionId: institution.id },
      select: { id: true, name: true, role: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canEdit = user.role === ROLE.SYSTEM_ADMIN;

  return (
    <>
      <PageHead
        eyebrow={`Institution · ${institution.aicteRef}`}
        title={institution.name}
        description={`${institution.category} · ${institution.state}${institution.city ? ` · ${institution.city}` : ""} · ${users.length} user(s) on this tenant.`}
        actions={<Link href="/institutions" className="btn btn--ghost">Directory</Link>}
      />

      <div className="stat-grid">
        <Stat label="FDR records (all)" value={stats.total} detail={`${stats.drafts} draft(s)`} />
        <Stat label="Active instruments" value={stats.active} detail="Lifecycle ACTIVE only" href={`/instruments?institution=${institution.id}`} />
        <Stat label="Maturing ≤ 90 days" value={stats.maturingSoon} detail="Date-derived" attention={stats.maturingSoon > 0} />
        <Stat label="Matured, not released" value={stats.overdue} detail="Still ACTIVE after maturity" attention={stats.overdue > 0} />
        <Stat label="Pending verification" value={stats.pendingVerification} detail="No independent check recorded" />
        <Stat label="Replaced" value={stats.replaced} detail="Excluded from exposure" />
        <Stat label="Released / closed" value={stats.released} detail="Administrative record" />
        <Stat label="Active exposure" value={formatMoney(stats.activeExposure, { compact: true })} detail="Sum of ACTIVE principal" money />
      </div>

      <Notice tone="quiet" title="How these numbers are computed">
        <strong>Active exposure</strong> sums the recorded principal of ACTIVE instruments only —
        replaced predecessors and released instruments are excluded so a predecessor and its
        successor are never double-counted. It is a <em>recorded</em> amount, not independently
        verified financial exposure.{" "}
        <strong>All-time recorded amount</strong> (ledger view): {formatMoney(stats.historicalAmount)}{" "}
        across every instrument row ever recorded. Maturity buckets are derived from the demo
        clock on each read, never stored.
      </Notice>

      <div className="split">
        <div className="stack">
          <Card>
            <CardHead
              title="FDR records"
              description="Institution-scoped; filters and pagination run on the server."
              action={<Badge tone="muted">{fdrs.total} total</Badge>}
            />
            <CardBody flush>
              <div className="filter-bar" style={{ padding: "12px 18px", margin: 0 }}>
                {["ALL", LIFECYCLE.ACTIVE, LIFECYCLE.SUBMITTED, LIFECYCLE.DRAFT, LIFECYCLE.REPLACED, LIFECYCLE.CLOSED].map((status) => {
                  const active = (queryParams.status ?? "ALL") === status;
                  return (
                    <Link
                      key={status}
                      href={fdrHref(institution.id, queryParams, { status: status === "ALL" ? undefined : status, page: "1" })}
                      className={`filter-chip${active ? " filter-chip--active" : ""}`}
                    >
                      {status === "ALL" ? "All" : LIFECYCLE_LABEL[status] ?? status}
                    </Link>
                  );
                })}
              </div>
              {fdrs.rows.length === 0 ? (
                <EmptyState
                  title="No FDR records match"
                  description="Nothing has been recorded for this institution with the current filters."
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Amount</th>
                        <th>Maturity</th>
                        <th>Lifecycle</th>
                        <th>Verification</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fdrs.rows.map((instrument) => {
                        const maturity = deriveMaturity(instrument.maturityDate, today);
                        return (
                          <tr key={instrument.id}>
                            <td>
                              <Link href={`/instruments/${instrument.id}`} className="data-table__primary mono">
                                {instrument.fdrNumber}
                              </Link>
                              <div className="data-table__sub">{instrument.bankName}</div>
                            </td>
                            <td className="amount">{formatMoney(instrument.amount)}</td>
                            <td>
                              <div className="nowrap">{formatDate(instrument.maturityDate)}</div>
                              <div className="data-table__sub">{maturity.label}</div>
                            </td>
                            <td>
                              <StatusBadge value={instrument.lifecycleStatus} label={LIFECYCLE_LABEL[instrument.lifecycleStatus]} />
                            </td>
                            <td>
                              <StatusBadge value={instrument.verificationStatus} label={VERIFICATION_LABEL[instrument.verificationStatus]} />
                            </td>
                            <td>
                              <Link href={`/instruments/${instrument.id}`} className="btn btn--ghost btn--small">Open</Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
            {fdrs.total > fdrs.rows.length ? (
              <div className="card__foot">
                <span className="tiny muted">Showing {fdrs.rows.length} of {fdrs.total}</span>
                <span className="btn-row">
                  {fdrs.page > 1 ? (
                    <Link href={fdrHref(institution.id, queryParams, { page: String(fdrs.page - 1) })} className="btn btn--ghost btn--small">Previous</Link>
                  ) : null}
                  <span className="tiny muted">Page {fdrs.page} / {fdrs.pageCount}</span>
                  {fdrs.page < fdrs.pageCount ? (
                    <Link href={fdrHref(institution.id, queryParams, { page: String(fdrs.page + 1) })} className="btn btn--ghost btn--small">Next</Link>
                  ) : null}
                </span>
              </div>
            ) : null}
          </Card>
        </div>

        <aside className="stack">
          <Card>
            <CardHead title="Profile" description="Directory identifiers and classification." />
            <CardBody>
              <DefinitionList
                tight
                items={[
                  { label: "Institution code", value: <span className="mono">{institution.aicteRef}</span> },
                  { label: "Category", value: institution.category },
                  { label: "State", value: institution.state },
                  { label: "City", value: institution.city ?? "—" },
                  { label: "Registered", value: formatDate(institution.createdAt) },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title="Users on this tenant"
              description="Session roles determine what each account can see or do."
            />
            <CardBody flush>
              {users.length === 0 ? (
                <EmptyState title="No users" description="No accounts are linked to this institution yet." />
              ) : (
                <ul className="list-clean">
                  {users.map((account) => (
                    <li key={account.id} style={{ padding: "11px 18px", borderBottom: "1px solid var(--line)" }}>
                      <div className="row-between">
                        <span style={{ fontSize: 13 }}>{account.name}</span>
                        <Badge tone="muted">{account.role.replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="tiny muted">{account.email}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {canEdit ? (
            <Card>
              <CardHead
                title="Edit profile"
                description="System Admin only. The server rejects duplicate institution codes."
              />
              <CardBody>
                <ApiForm
                  action={`/api/institutions/${institution.id}`}
                  method="PATCH"
                  submitLabel="Save profile"
                  successMessage="Profile updated; the change was written to the audit trail."
                  note="Duplicate codes are rejected server-side."
                >
                  <div className="field">
                    <label htmlFor="inst-name">Institution name</label>
                    <input id="inst-name" name="name" type="text" required maxLength={160} defaultValue={institution.name} />
                  </div>
                  <div className="field">
                    <label htmlFor="inst-code">Institution code</label>
                    <input id="inst-code" name="aicteRef" type="text" required maxLength={40} defaultValue={institution.aicteRef} />
                    <span className="field__hint">Must be unique across the directory.</span>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="inst-category">Category</label>
                      <input id="inst-category" name="category" type="text" required maxLength={80} defaultValue={institution.category} />
                    </div>
                    <div className="field">
                      <label htmlFor="inst-state">State</label>
                      <input id="inst-state" name="state" type="text" required maxLength={80} defaultValue={institution.state} />
                    </div>
                    <div className="field">
                      <label htmlFor="inst-city">City</label>
                      <input id="inst-city" name="city" type="text" maxLength={80} defaultValue={institution.city ?? ""} />
                    </div>
                  </div>
                </ApiForm>
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
