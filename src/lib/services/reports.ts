import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { CASE_OPEN_STATUSES, INSTITUTION_ROLES, LIFECYCLE, ROLE } from "../constants";
import type { SessionUser } from "../auth";
import { addDays, parseIsoDate } from "../dates";
import { getToday } from "../demo-clock";
import { csvLine } from "../csv";

export type ReportFilters = {
  institutionId?: string;
  bank?: string;
  status?: string;
  from?: string;
  to?: string;
};

export type ReportColumn = {
  key: string;
  label: string;
  numeric?: boolean;
  money?: boolean;
};

export type ReportRow = Record<string, string | number | null>;

export type ReportResult = {
  id: string;
  title: string;
  description: string;
  /** What the totals mean — shown under the table and in the CSV header comment. */
  definition: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  totals: Record<string, number>;
  /** status filter maps to case status instead of lifecycle status. */
  statusFilterKind: "lifecycle" | "case" | "none";
  sortable: boolean;
};

const OPEN_FINDING_STATES = ["OPEN", "CORRECTION_REQUESTED"];
const PENDING_VERIFICATION = [
  "NOT_CHECKED",
  "NEEDS_REVIEW",
  "PENDING_EXTERNAL_VERIFICATION",
];

/** Instrument-role sessions are pinned to their own tenant in every report. */
function scopeInstitution(user: SessionUser, requested?: string): string | null {
  if (INSTITUTION_ROLES.includes(user.role)) return user.institutionId;
  if (user.role === ROLE.SERVICE_ACCOUNT) return "__service_account__";
  return requested || null;
}

function safeDate(value: string | undefined): Date | null {
  if (!value) return null;
  try {
    return parseIsoDate(value);
  } catch {
    return null;
  }
}

async function instrumentWhere(
  user: SessionUser,
  filters: ReportFilters,
  today: Date,
): Promise<Prisma.InstrumentWhereInput> {
  const where: Prisma.InstrumentWhereInput = {};
  const institutionId = scopeInstitution(user, filters.institutionId);
  if (institutionId) where.institutionId = institutionId;
  if (filters.bank) where.normalizedBank = { contains: filters.bank.toLowerCase().replace(/[^a-z0-9]/g, "") };
  if (filters.status && (Object.values(LIFECYCLE) as string[]).includes(filters.status)) {
    where.lifecycleStatus = filters.status;
  }
  const from = safeDate(filters.from);
  const to = safeDate(filters.to);
  if (from || to) {
    where.maturityDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }
  void today;
  return where;
}

type ReportDef = {
  title: string;
  description: string;
  definition: string;
  statusFilterKind: "lifecycle" | "case" | "none";
  /** Aggregate reports materialise every row, so URL-driven sorting is exact. */
  inMemorySort?: boolean;
  run: (
    user: SessionUser,
    filters: ReportFilters,
    opts: { page: number; pageSize: number; today: Date },
  ) => Promise<Omit<ReportResult, "id" | "title" | "description" | "definition" | "statusFilterKind" | "sortable" | "page" | "pageSize"> & { page?: number; pageSize?: number }>;
  /** Batched CSV rows; aggregate reports emit their (small) result directly. */
  stream: (user: SessionUser, filters: ReportFilters, today: Date) => AsyncGenerator<ReportRow[]>;
};

const ACTIVE_EXCLUSION = [LIFECYCLE.REPLACED, LIFECYCLE.CLOSED, LIFECYCLE.ARCHIVED];

export const REPORTS: Record<string, ReportDef> = {
  "institution-exposure": {
    title: "Institution-wise recorded deposit exposure",
    description: "Recorded principal grouped by institution.",
    inMemorySort: true,
    definition:
      "Active exposure sums ACTIVE instruments only (replaced, released and archived rows excluded, so predecessors and successors are never double-counted). All-time recorded amount is a ledger total across every row ever recorded. Neither figure is independently verified financial exposure.",
    statusFilterKind: "none",
    async run(user, filters, opts) {
      const where = await instrumentWhere(user, filters, opts.today);
      const activeWhere = { ...where, lifecycleStatus: LIFECYCLE.ACTIVE };
      const [allGroups, activeGroups, institutions] = await Promise.all([
        prisma.instrument.groupBy({ by: ["institutionId"], where, _count: { _all: true }, _sum: { amount: true } }),
        prisma.instrument.groupBy({ by: ["institutionId"], where: activeWhere, _count: { _all: true }, _sum: { amount: true } }),
        prisma.institution.findMany({ select: { id: true, name: true, aicteRef: true, state: true } }),
      ]);
      const names = new Map(institutions.map((i) => [i.id, i]));
      const activeById = new Map(activeGroups.map((g) => [g.institutionId, g]));
      const rows = allGroups
        .map((group) => {
          const institution = names.get(group.institutionId);
          const active = activeById.get(group.institutionId);
          return {
            institution: institution?.name ?? "—",
            aicteRef: institution?.aicteRef ?? "—",
            state: institution?.state ?? "—",
            records: group._count._all,
            activeRecords: active?._count._all ?? 0,
            activeExposure: Number(active?._sum.amount ?? 0),
            allTimeRecorded: Number(group._sum.amount ?? 0),
          };
        })
        .sort((a, b) => b.activeExposure - a.activeExposure);
      return {
        columns: [
          { key: "institution", label: "Institution" },
          { key: "aicteRef", label: "Code" },
          { key: "state", label: "State" },
          { key: "records", label: "Records (all)", numeric: true },
          { key: "activeRecords", label: "Active", numeric: true },
          { key: "activeExposure", label: "Active exposure", money: true },
          { key: "allTimeRecorded", label: "All-time recorded", money: true },
        ],
        rows,
        total: rows.length,
        pageCount: 1,
        totals: {
          records: rows.reduce((sum, row) => sum + (row.records as number), 0),
          activeRecords: rows.reduce((sum, row) => sum + (row.activeRecords as number), 0),
          activeExposure: rows.reduce((sum, row) => sum + (row.activeExposure as number), 0),
          allTimeRecorded: rows.reduce((sum, row) => sum + (row.allTimeRecorded as number), 0),
        },
      };
    },
    async *stream(user, filters, today) {
      const result = await REPORTS["institution-exposure"].run(user, filters, { page: 1, pageSize: 10_000, today });
      yield result.rows;
    },
  },

  "bank-exposure": {
    title: "Bank-wise recorded deposit exposure",
    description: "Recorded principal grouped by bank (normalized name).",
    inMemorySort: true,
    definition:
      "Grouped on the normalized bank name so variants of the same bank merge. Active exposure counts ACTIVE records only; the all-time column includes replaced and released rows.",
    statusFilterKind: "none",
    async run(user, filters, opts) {
      const where = await instrumentWhere(user, filters, opts.today);
      const activeWhere = { ...where, lifecycleStatus: LIFECYCLE.ACTIVE };
      const [allGroups, activeGroups] = await Promise.all([
        prisma.instrument.groupBy({
          by: ["normalizedBank"],
          where,
          _count: { _all: true },
          _sum: { amount: true },
          _max: { bankName: true },
        }),
        prisma.instrument.groupBy({
          by: ["normalizedBank"],
          where: activeWhere,
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);
      const activeByBank = new Map(activeGroups.map((g) => [g.normalizedBank, g]));
      const rows = allGroups
        .map((group) => {
          const active = activeByBank.get(group.normalizedBank);
          return {
            bank: group._max.bankName ?? group.normalizedBank,
            records: group._count._all,
            activeRecords: active?._count._all ?? 0,
            activeExposure: Number(active?._sum.amount ?? 0),
            allTimeRecorded: Number(group._sum.amount ?? 0),
          };
        })
        .sort((a, b) => b.activeExposure - a.activeExposure);
      return {
        columns: [
          { key: "bank", label: "Bank" },
          { key: "records", label: "Records (all)", numeric: true },
          { key: "activeRecords", label: "Active", numeric: true },
          { key: "activeExposure", label: "Active exposure", money: true },
          { key: "allTimeRecorded", label: "All-time recorded", money: true },
        ],
        rows,
        total: rows.length,
        pageCount: 1,
        totals: {
          records: rows.reduce((sum, row) => sum + (row.records as number), 0),
          activeRecords: rows.reduce((sum, row) => sum + (row.activeRecords as number), 0),
          activeExposure: rows.reduce((sum, row) => sum + (row.activeExposure as number), 0),
          allTimeRecorded: rows.reduce((sum, row) => sum + (row.allTimeRecorded as number), 0),
        },
      };
    },
    async *stream(user, filters, today) {
      const result = await REPORTS["bank-exposure"].run(user, filters, { page: 1, pageSize: 10_000, today });
      yield result.rows;
    },
  },

  "status-counts": {
    title: "Instrument status counts",
    description: "Active, expiring, matured, replaced and released counts with amounts.",
    inMemorySort: true,
    definition:
      "Counts are lifecycle states as stored; the maturity columns are derived from the demo clock at query time and are never stored. Replaced and released amounts are excluded from active exposure.",
    statusFilterKind: "lifecycle",
    async run(user, filters, opts) {
      const where = await instrumentWhere(user, filters, opts.today);
      const [groups, maturing, overdue] = await Promise.all([
        prisma.instrument.groupBy({
          by: ["lifecycleStatus"],
          where,
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.instrument.count({
          where: { ...where, lifecycleStatus: LIFECYCLE.ACTIVE, maturityDate: { gte: opts.today, lte: addDays(opts.today, 90) } },
        }),
        prisma.instrument.count({
          where: { ...where, lifecycleStatus: LIFECYCLE.ACTIVE, maturityDate: { lt: opts.today } },
        }),
      ]);
      const rows = groups
        .map((group) => ({
          status: group.lifecycleStatus,
          records: group._count._all,
          amount: Number(group._sum.amount ?? 0),
        }))
        .sort((a, b) => b.records - a.records);
      const activeRows = groups.filter((group) => group.lifecycleStatus === LIFECYCLE.ACTIVE);
      return {
        columns: [
          { key: "status", label: "Lifecycle status" },
          { key: "records", label: "Records", numeric: true },
          { key: "amount", label: "Recorded amount", money: true },
        ],
        rows: [
          ...rows,
          { status: "DERIVED_MATURING_90D", records: maturing, amount: null },
          { status: "DERIVED_MATURED_NOT_RELEASED", records: overdue, amount: null },
        ],
        total: rows.length,
        pageCount: 1,
        totals: {
          records: rows.reduce((sum, row) => sum + (row.records as number), 0),
          amount: rows.reduce((sum, row) => sum + (row.amount as number), 0),
          activeAmount: activeRows.reduce((sum, group) => sum + Number(group._sum.amount ?? 0), 0),
        },
      };
    },
    async *stream(user, filters, today) {
      const result = await REPORTS["status-counts"].run(user, filters, { page: 1, pageSize: 10_000, today });
      yield result.rows;
    },
  },

  "pending-verification": {
    title: "Pending verification",
    description: "Records where no independent check outcome has been recorded.",
    definition:
      "Lists non-terminal instruments whose verificationStatus is NOT_CHECKED, NEEDS_REVIEW or PENDING_EXTERNAL_VERIFICATION. Extraction is never counted as verification.",
    statusFilterKind: "lifecycle",
    async run(user, filters, opts) {
      const where = await instrumentWhere(user, filters, opts.today);
      const scoped: Prisma.InstrumentWhereInput = {
        AND: [
          where,
          {
            lifecycleStatus: { notIn: [...ACTIVE_EXCLUSION] },
            verificationStatus: { in: PENDING_VERIFICATION },
          },
        ],
      };
      const [total, page] = await Promise.all([
        prisma.instrument.count({ where: scoped }),
        prisma.instrument.findMany({
          where: scoped,
          orderBy: { maturityDate: "asc" },
          skip: (opts.page - 1) * opts.pageSize,
          take: opts.pageSize,
          include: { institution: { select: { name: true } } },
        }),
      ]);
      const rows = page.map((instrument) => ({
        fdrNumber: instrument.fdrNumber,
        institution: instrument.institution.name,
        bank: instrument.bankName,
        amount: Number(instrument.amount.toString()),
        lifecycle: instrument.lifecycleStatus,
        verification: instrument.verificationStatus,
        maturity: instrument.maturityDate.toISOString().slice(0, 10),
      }));
      return {
        columns: [
          { key: "fdrNumber", label: "FDR number" },
          { key: "institution", label: "Institution" },
          { key: "bank", label: "Bank" },
          { key: "amount", label: "Amount", money: true },
          { key: "lifecycle", label: "Lifecycle" },
          { key: "verification", label: "Verification" },
          { key: "maturity", label: "Maturity" },
        ],
        rows,
        total,
        pageCount: Math.max(1, Math.ceil(total / opts.pageSize)),
        totals: { records: total },
      };
    },
    async *stream(user, filters, today) {
      let cursor: { id?: string } = {};
      while (true) {
        const batch = await prisma.instrument.findMany({
          where: {
            AND: [
              await instrumentWhere(user, filters, today),
              {
                lifecycleStatus: { notIn: [...ACTIVE_EXCLUSION] },
                verificationStatus: { in: PENDING_VERIFICATION },
              },
            ],
          },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor.id ? { cursor: { id: cursor.id }, skip: 1 } : {}),
          include: { institution: { select: { name: true } } },
        });
        if (batch.length === 0) return;
        cursor = { id: batch[batch.length - 1].id };
        yield batch.map((instrument) => ({
          fdrNumber: instrument.fdrNumber,
          institution: instrument.institution.name,
          bank: instrument.bankName,
          amount: Number(instrument.amount.toString()),
          lifecycle: instrument.lifecycleStatus,
          verification: instrument.verificationStatus,
          maturity: instrument.maturityDate.toISOString().slice(0, 10),
        }));
      }
    },
  },

  discrepancies: {
    title: "Open discrepancies",
    description: "Findings awaiting resolution, with severity and instrument context.",
    definition:
      "Findings are deterministic consistency explanations, not proof of authenticity. Only OPEN and CORRECTION_REQUESTED findings are listed; resolved and superseded findings stay in the audit trail.",
    statusFilterKind: "lifecycle",
    async run(user, filters, opts) {
      const base = await instrumentWhere(user, filters, opts.today);
      const where: Prisma.FindingWhereInput = {
        resolutionStatus: { in: OPEN_FINDING_STATES },
        instrument: base,
      };
      const [total, page] = await Promise.all([
        prisma.finding.count({ where }),
        prisma.finding.findMany({
          where,
          orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
          skip: (opts.page - 1) * opts.pageSize,
          take: opts.pageSize,
          include: { instrument: { include: { institution: { select: { name: true } } } } },
        }),
      ]);
      const rows = page.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        fdrNumber: finding.instrument.fdrNumber,
        institution: finding.instrument.institution.name,
        field: finding.field ?? "—",
        observed: finding.observed ?? "—",
        status: finding.resolutionStatus,
        created: finding.createdAt.toISOString().slice(0, 10),
      }));
      return {
        columns: [
          { key: "ruleId", label: "Rule" },
          { key: "severity", label: "Severity" },
          { key: "fdrNumber", label: "FDR number" },
          { key: "institution", label: "Institution" },
          { key: "field", label: "Field" },
          { key: "observed", label: "Observed" },
          { key: "status", label: "Status" },
          { key: "created", label: "Raised" },
        ],
        rows,
        total,
        pageCount: Math.max(1, Math.ceil(total / opts.pageSize)),
        totals: { records: total },
      };
    },
    async *stream(user, filters, today) {
      let cursor: { id?: string } = {};
      while (true) {
        const batch = await prisma.finding.findMany({
          where: {
            resolutionStatus: { in: OPEN_FINDING_STATES },
            instrument: await instrumentWhere(user, filters, today),
          },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor.id ? { cursor: { id: cursor.id }, skip: 1 } : {}),
          include: { instrument: { include: { institution: { select: { name: true } } } } },
        });
        if (batch.length === 0) return;
        cursor = { id: batch[batch.length - 1].id };
        yield batch.map((finding) => ({
          ruleId: finding.ruleId,
          severity: finding.severity,
          fdrNumber: finding.instrument.fdrNumber,
          institution: finding.instrument.institution.name,
          field: finding.field ?? "—",
          observed: finding.observed ?? "—",
          status: finding.resolutionStatus,
          created: finding.createdAt.toISOString().slice(0, 10),
        }));
      }
    },
  },

  maturities: {
    title: "Upcoming maturities and overdue renewals",
    description: "ACTIVE instruments ordered by maturity; overdue first.",
    definition:
      "Overdue means the maturity date has passed while the record is still ACTIVE with no recorded release or replacement action. Derived from the demo clock at query time.",
    statusFilterKind: "none",
    async run(user, filters, opts) {
      const where = await instrumentWhere(user, filters, opts.today);
      const scoped: Prisma.InstrumentWhereInput = {
        AND: [where, { lifecycleStatus: LIFECYCLE.ACTIVE }],
      };
      const [total, page] = await Promise.all([
        prisma.instrument.count({ where: scoped }),
        prisma.instrument.findMany({
          where: scoped,
          orderBy: { maturityDate: "asc" },
          skip: (opts.page - 1) * opts.pageSize,
          take: opts.pageSize,
          include: { institution: { select: { name: true } } },
        }),
      ]);
      const rows = page.map((instrument) => {
        const days = Math.round(
          (instrument.maturityDate.getTime() - opts.today.getTime()) / 86_400_000,
        );
        return {
          fdrNumber: instrument.fdrNumber,
          institution: instrument.institution.name,
          bank: instrument.bankName,
          amount: Number(instrument.amount.toString()),
          maturity: instrument.maturityDate.toISOString().slice(0, 10),
          bucket: days < 0 ? "OVERDUE" : days <= 90 ? "MATURING_90D" : "UPCOMING",
          days: days,
        };
      });
      return {
        columns: [
          { key: "fdrNumber", label: "FDR number" },
          { key: "institution", label: "Institution" },
          { key: "bank", label: "Bank" },
          { key: "amount", label: "Amount", money: true },
          { key: "maturity", label: "Maturity" },
          { key: "bucket", label: "Bucket" },
          { key: "days", label: "Days", numeric: true },
        ],
        rows,
        total,
        pageCount: Math.max(1, Math.ceil(total / opts.pageSize)),
        totals: { records: total, amount: rows.reduce((sum, row) => sum + (row.amount as number), 0) },
      };
    },
    async *stream(user, filters, today) {
      let cursor: { id?: string } = {};
      while (true) {
        const batch = await prisma.instrument.findMany({
          where: {
            AND: [await instrumentWhere(user, filters, today), { lifecycleStatus: LIFECYCLE.ACTIVE }],
          },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor.id ? { cursor: { id: cursor.id }, skip: 1 } : {}),
          include: { institution: { select: { name: true } } },
        });
        if (batch.length === 0) return;
        cursor = { id: batch[batch.length - 1].id };
        yield batch.map((instrument) => {
          const days = Math.round(
            (instrument.maturityDate.getTime() - today.getTime()) / 86_400_000,
          );
          return {
            fdrNumber: instrument.fdrNumber,
            institution: instrument.institution.name,
            bank: instrument.bankName,
            amount: Number(instrument.amount.toString()),
            maturity: instrument.maturityDate.toISOString().slice(0, 10),
            bucket: days < 0 ? "OVERDUE" : days <= 90 ? "MATURING_90D" : "UPCOMING",
            days,
          };
        });
      }
    },
  },

  "case-status": {
    title: "Release / refund request status",
    description: "Case counts by type and status, plus open-case detail.",
    definition:
      "Opening or approving a case never changes the instrument lifecycle by itself. Counts reflect case records, not bank instructions.",
    statusFilterKind: "case",
    async run(user, filters, opts) {
      const institutionId = scopeInstitution(user, filters.institutionId);
      const where: Prisma.ReleaseCaseWhereInput = {};
      if (institutionId) where.institutionId = institutionId;
      if (filters.status && ["OPEN", "IN_REVIEW", "RETURNED", "ESCALATED", "APPROVED", "REJECTED", "WITHDRAWN", "CLOSED"].includes(filters.status)) {
        where.status = filters.status;
      }
      const [groups, openTotal, openRows] = await Promise.all([
        prisma.releaseCase.groupBy({ by: ["type", "status"], where, _count: { _all: true } }),
        prisma.releaseCase.count({ where }),
        prisma.releaseCase.findMany({
          where: { ...where, status: { in: [...CASE_OPEN_STATUSES] } },
          orderBy: { createdAt: "asc" },
          skip: (opts.page - 1) * opts.pageSize,
          take: opts.pageSize,
          include: {
            institution: { select: { name: true } },
            instrument: { select: { fdrNumber: true } },
          },
        }),
      ]);
      const summary = groups
        .map((group) => ({
          type: group.type,
          status: group.status,
          cases: group._count._all,
        }))
        .sort((a, b) => a.type.localeCompare(b.type) || a.status.localeCompare(b.status));
      const open = openRows.map((item) => ({
        type: item.type,
        status: item.status,
        fdrNumber: item.instrument.fdrNumber,
        institution: item.institution.name,
        created: item.createdAt.toISOString().slice(0, 10),
      }));
      return {
        columns: summary.length > 0 && open.length === 0
          ? [
              { key: "type", label: "Case type" },
              { key: "status", label: "Status" },
              { key: "cases", label: "Cases", numeric: true },
            ]
          : [
              { key: "type", label: "Case type" },
              { key: "status", label: "Status" },
              { key: "fdrNumber", label: "FDR number" },
              { key: "institution", label: "Institution" },
              { key: "created", label: "Created" },
            ],
        rows: open.length > 0 ? open : summary,
        total: openTotal,
        pageCount: Math.max(1, Math.ceil(openTotal / opts.pageSize)),
        totals: { cases: openTotal },
      };
    },
    async *stream(user, filters) {
      let cursor: { id?: string } = {};
      const institutionId = scopeInstitution(user, filters.institutionId);
      while (true) {
        const batch = await prisma.releaseCase.findMany({
          where: {
            ...(institutionId ? { institutionId } : {}),
          },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor.id ? { cursor: { id: cursor.id }, skip: 1 } : {}),
          include: {
            institution: { select: { name: true } },
            instrument: { select: { fdrNumber: true } },
          },
        });
        if (batch.length === 0) return;
        cursor = { id: batch[batch.length - 1].id };
        yield batch.map((item) => ({
          type: item.type,
          status: item.status,
          fdrNumber: item.instrument.fdrNumber,
          institution: item.institution.name,
          created: item.createdAt.toISOString().slice(0, 10),
        }));
      }
    },
  },
};

export const REPORT_IDS = Object.keys(REPORTS);

export async function runReport(
  reportId: string,
  user: SessionUser,
  filters: ReportFilters,
  opts: { page?: number; pageSize?: number; sort?: string; dir?: string } = {},
): Promise<ReportResult> {
  const def = REPORTS[reportId];
  if (!def) throw new Error(`Unknown report: ${reportId}`);
  const today = await getToday();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25));
  const result = await def.run(user, filters, { page, pageSize, today });
  let rows = result.rows;
  if (def.inMemorySort && opts.sort && rows.length > 0 && rows[0][opts.sort] !== undefined) {
    const factor = opts.dir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const left = a[opts.sort!];
      const right = b[opts.sort!];
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * factor;
      }
      return String(left ?? "").localeCompare(String(right ?? "")) * factor;
    });
  }
  return {
    ...result,
    rows,
    id: reportId,
    title: def.title,
    description: def.description,
    definition: def.definition,
    statusFilterKind: def.statusFilterKind,
    sortable: !!def.inMemorySort,
    page,
    pageSize,
    pageCount: result.pageCount,
  };
}

/** Emits CSV text incrementally: header line, then batched data lines. */
export async function* reportCsvChunks(
  reportId: string,
  user: SessionUser,
  filters: ReportFilters,
): AsyncGenerator<string> {
  const def = REPORTS[reportId];
  if (!def) throw new Error(`Unknown report: ${reportId}`);
  const today = await getToday();
  const result = await def.run(user, filters, { page: 1, pageSize: 1, today });
  yield csvLine(result.columns.map((column) => column.label));
  let emitted = 0;
  for await (const batch of def.stream(user, filters, today)) {
    for (const row of batch) {
      emitted += 1;
      yield csvLine(result.columns.map((column) => row[column.key] ?? ""));
    }
  }
  void emitted;
}
