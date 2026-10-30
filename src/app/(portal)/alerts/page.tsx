import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { instrumentScope } from "@/lib/rbac";
import {
  ALERT_THRESHOLDS,
  INSTITUTION_ROLES,
  LIFECYCLE,
  ROLE,
  type Role,
} from "@/lib/constants";
import {
  addDays,
  deriveMaturity,
  formatDate,
  formatDateTime,
  toIsoDate,
} from "@/lib/dates";
import { getDemoState, getToday, demoMode } from "@/lib/demo-clock";
import { formatMoney } from "@/lib/money";
import { ApiForm } from "@/components/ApiForm";
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

const ALLOWED: Role[] = [
  ROLE.INSTITUTION_ADMIN,
  ROLE.INSTITUTION_VIEWER,
  ROLE.SCRUTINY_OFFICER,
  ROLE.COMPETENT_AUTHORITY,
  ROLE.SYSTEM_ADMIN,
  ROLE.AUDITOR,
];
const SCAN_ROLES: Role[] = [
  ROLE.SCRUTINY_OFFICER,
  ROLE.COMPETENT_AUTHORITY,
  ROLE.SYSTEM_ADMIN,
];
const ACK_ROLES: Role[] = [
  ROLE.INSTITUTION_ADMIN,
  ROLE.INSTITUTION_VIEWER,
  ROLE.SCRUTINY_OFFICER,
  ROLE.COMPETENT_AUTHORITY,
];

export default async function AlertsPage() {
  const user = await requireUser();
  if (!ALLOWED.includes(user.role)) redirect("/");
  const today = await getToday();
  const clock = await getDemoState();
  const canScan = SCAN_ROLES.includes(user.role);
  const showClock = canScan && demoMode();

  const alertWhere: Prisma.MaturityAlertWhereInput = INSTITUTION_ROLES.includes(user.role)
    ? { recipientId: user.id }
    : {};
  const [instruments, alerts] = await Promise.all([
    prisma.instrument.findMany({
      where: {
        AND: [
          instrumentScope(user),
          { lifecycleStatus: LIFECYCLE.ACTIVE },
          { maturityDate: { lte: addDays(today, 365) } },
        ],
      },
      include: {
        institution: true,
        alerts: { orderBy: { sentAt: "desc" } },
      },
      orderBy: { maturityDate: "asc" },
      take: 100,
    }),
    prisma.maturityAlert.findMany({
      where: alertWhere,
      include: { instrument: { include: { institution: true } } },
      orderBy: { sentAt: "desc" },
      take: 80,
    }),
  ]);

  const unack = alerts.filter((alert) => !alert.ackAt);
  const matured = instruments.filter(
    (instrument) => deriveMaturity(instrument.maturityDate, today).bucket === "MATURED",
  );
  const maturing = instruments.filter(
    (instrument) => deriveMaturity(instrument.maturityDate, today).bucket === "MATURING",
  );

  return (
    <>
      <PageHead
        eyebrow="Maturity tracker"
        title="Alerts before a deposit slips past action."
        description="Maturity buckets are derived from the date and the current clock. The lifecycle is never overwritten by a bucket. Alerts are in-app and deduplicated per record, threshold, channel and recipient."
        actions={<Link href="/instruments" className="btn btn--ghost">Records</Link>}
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Active in 12 months" value={instruments.length} detail="Active records only" />
          <Stat label="Maturing ≤90 days" value={maturing.length} detail="Derived, not a lifecycle state" attention={maturing.length > 0} />
          <Stat label="Matured, no action" value={matured.length} detail="Date-derived overdue bucket" attention={matured.length > 0} />
          <Stat label="Unacknowledged alerts" value={unack.length} detail={`${alerts.length} alert(s) visible`} attention={unack.length > 0} />
        </div>

        {showClock ? (
          <Card>
            <CardHead
              title="Demo clock & scan"
              description="Freeze today's date to rehearse 90/60/30-day alerts deterministically. Demo-only; disabled outside DEMO_MODE."
              action={
                <Badge tone={clock.frozen ? "attention" : "muted"}>
                  {clock.frozen ? `Frozen ${formatDate(clock.demoDate!)}` : "Live IST date"}
                </Badge>
              }
            />
            <CardBody>
              <div className="split">
                <div>
                  <div className="tag" style={{ marginBottom: 8 }}>Set the demo date</div>
                  <ApiForm
                    action="/api/demo/clock"
                    submitLabel="Freeze date"
                    successMessage="Demo clock set. Run a maturity scan to evaluate thresholds."
                    note="Only authorized demo roles can change the clock."
                  >
                    <div className="field">
                      <label htmlFor="demo-date">Demo date</label>
                      <input
                        id="demo-date"
                        name="date"
                        type="date"
                        defaultValue={clock.demoDate ? toIsoDate(clock.demoDate) : ""}
                        required
                      />
                    </div>
                  </ApiForm>
                  <div style={{ marginTop: 10 }}>
                    <ApiForm
                      action="/api/demo/clock"
                      submitLabel="Use real date"
                      successMessage="Demo clock cleared; the live IST date is in use."
                      buttonClassName="btn btn--ghost btn--small"
                      className=""
                    >
                      <input type="hidden" name="date" value="" />
                    </ApiForm>
                  </div>
                </div>
                <div>
                  <div className="tag" style={{ marginBottom: 8 }}>Evaluate alerts</div>
                  <ApiForm
                    action="/api/alerts/scan"
                    submitLabel="Run maturity scan"
                    successMessage="Maturity scan complete. Duplicate alerts were skipped."
                    confirmText="Run the maturity scan against the current demo clock?"
                    note={`Thresholds: ${ALERT_THRESHOLDS.join(
                      " / ",
                    )} days plus a matured alert. In-app only; no external delivery is claimed.`}
                  />
                  <div className="tiny muted" style={{ marginTop: 10 }}>
                    Today is {formatDate(today)}. Second runs are idempotent for the same
                    instrument, threshold, channel and recipient.
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Notice tone="quiet" title="Alert generation">
            Alerts are generated by the AICTE scrutiny role from the configured clock. Institution
            users acknowledge the alerts addressed to them. This prototype does not send email,
            SMS or WhatsApp messages.
          </Notice>
        )}

        <div className="split">
          <Card>
            <CardHead
              title="Alert history"
              description="Newest first. Status here is delivery/acknowledgement, not instrument lifecycle."
              action={<Badge tone="muted">{alerts.length} visible</Badge>}
            />
            <CardBody flush>
              {alerts.length === 0 ? (
                <EmptyState
                  title="No alerts yet"
                  description={
                    canScan
                      ? "Run a maturity scan to evaluate active records against 90/60/30-day thresholds and the matured bucket."
                      : "Alerts addressed to your account will appear here after an AICTE scan."
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Threshold</th>
                        <th>Status</th>
                        <th>Sent</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map((alert) => (
                        <tr key={alert.id}>
                          <td>
                            <Link href={`/instruments/${alert.instrument.id}`} className="data-table__primary mono">
                              {alert.instrument.fdrNumber}
                            </Link>
                            <div className="data-table__sub">
                              {alert.instrument.institution.name} · matures{" "}
                              {formatDate(alert.instrument.maturityDate)}
                            </div>
                          </td>
                          <td>
                            <Badge tone={alert.thresholdDays === 0 ? "critical" : "attention"}>
                              {alert.thresholdDays === 0 ? "Matured" : `${alert.thresholdDays} days`}
                            </Badge>
                          </td>
                          <td>
                            <StatusBadge value={alert.ackAt ? "ACKNOWLEDGED" : alert.status} />
                            {alert.ackAt ? (
                              <div className="data-table__sub">Acknowledged {formatDate(alert.ackAt)}</div>
                            ) : null}
                          </td>
                          <td className="nowrap">{formatDateTime(alert.sentAt)}</td>
                          <td>
                            {!alert.ackAt && ACK_ROLES.includes(user.role) ? (
                              <ApiForm
                                action={`/api/alerts/${alert.id}/ack`}
                                submitLabel="Ack"
                                buttonClassName="btn btn--ghost btn--small"
                                successMessage="Alert acknowledged."
                                className=""
                              />
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
            <div className="card__foot">
              <span>
                Alert windows are product defaults (PDR ASM-002), not regulatory mandates.
              </span>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Active records by maturity"
              description="Date-derived buckets; lifecycle stays unchanged."
            />
            <CardBody flush>
              {instruments.length === 0 ? (
                <EmptyState title="No active records" description="Active records appear here once verified and tracked." />
              ) : (
                <ul className="list-clean">
                  {instruments.map((instrument) => {
                    const maturity = deriveMaturity(instrument.maturityDate, today);
                    return (
                      <li key={instrument.id} style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
                        <div className="row-between">
                          <Link href={`/instruments/${instrument.id}`} className="mono" style={{ fontSize: 11.5 }}>
                            {instrument.fdrNumber}
                          </Link>
                          <Badge tone={maturity.bucket === "MATURED" ? "critical" : maturity.bucket === "MATURING" ? "attention" : "muted"}>
                            {maturity.bucket}
                          </Badge>
                        </div>
                        <div className="tiny muted" style={{ marginTop: 3 }}>
                          {formatMoney(instrument.amount)} · {maturity.label} ·{" "}
                          {instrument.alerts.filter((alert) => !alert.ackAt).length} unack
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
            <div className="card__foot">
              <span>“Expired” is presented as the matured/overdue action bucket.</span>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
