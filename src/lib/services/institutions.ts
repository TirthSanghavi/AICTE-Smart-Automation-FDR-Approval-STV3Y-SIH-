import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { appendAudit, auditTransaction } from "../audit";
import { LIFECYCLE, ROLE, INSTITUTION_ROLES } from "../constants";
import { forbidden, invalid, notFound } from "../errors";
import type { SessionUser } from "../auth";
import { addDays } from "../dates";
import { getToday } from "../demo-clock";

/** Institution roles see only their own record; internal roles see the directory. */
export function institutionScope(user: SessionUser): Prisma.InstitutionWhereInput {
  if (INSTITUTION_ROLES.includes(user.role)) {
    if (!user.institutionId) return { id: "__no_institution__" };
    return { id: user.institutionId };
  }
  if (user.role === ROLE.SERVICE_ACCOUNT) return { id: "__service_account_no_ui__" };
  return {};
}

export const SORTABLE = {
  name: "name",
  aicteRef: "aicteRef",
  state: "state",
  category: "category",
  createdAt: "createdAt",
} as const;
export type InstitutionSort = keyof typeof SORTABLE;

export function parseSort(sort: string | undefined, dir: string | undefined) {
  const key = (Object.keys(SORTABLE) as string[]).includes(sort ?? "")
    ? (sort as InstitutionSort)
    : "name";
  const direction: Prisma.SortOrder = dir === "desc" ? "desc" : "asc";
  return { key, orderBy: { [SORTABLE[key]]: direction } as Prisma.InstitutionOrderByWithRelationInput };
}

export async function listInstitutions(
  user: SessionUser,
  params: { q?: string; category?: string; state?: string; page?: number; pageSize?: number; sort?: string; dir?: string },
) {
  const and: Prisma.InstitutionWhereInput[] = [institutionScope(user)];
  if (params.q) {
    const q = params.q.slice(0, 80);
    and.push({
      OR: [
        { name: { contains: q } },
        { aicteRef: { contains: q.toUpperCase() } },
        { aicteRef: { contains: q } },
        { city: { contains: q } },
      ],
    });
  }
  if (params.category) and.push({ category: params.category });
  if (params.state) and.push({ state: params.state });

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const { orderBy } = parseSort(params.sort, params.dir);

  const [total, rows, categories, states] = await Promise.all([
    prisma.institution.count({ where: { AND: and } }),
    prisma.institution.findMany({
      where: { AND: and },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { instruments: true, users: true } } },
    }),
    prisma.institution.findMany({
      where: { AND: institutionScope(user) },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    prisma.institution.findMany({
      where: { AND: institutionScope(user) },
      distinct: ["state"],
      select: { state: true },
      orderBy: { state: "asc" },
    }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    facets: {
      categories: categories.map((row) => row.category),
      states: states.map((row) => row.state),
    },
  };
}

export type InstitutionStats = {
  total: number;
  active: number;
  maturingSoon: number;
  overdue: number;
  pendingVerification: number;
  replaced: number;
  released: number;
  drafts: number;
  historicalAmount: number;
  activeExposure: number;
};

/**
 * Aggregation rules (also shown in the UI):
 * - historicalAmount sums EVERY instrument row ever recorded, including
 *   replaced ones — it is a ledger total, not current exposure.
 * - activeExposure sums only lifecycleStatus ACTIVE rows, so a replaced
 *   predecessor and its successor are never counted together.
 * - pendingVerification counts non-terminal records whose independent check
 *   has not been recorded (replaced/archived rows excluded).
 * - released = lifecycle CLOSED (an administrative record, not bank proof).
 */
export async function institutionStats(
  institutionId: string,
): Promise<InstitutionStats> {
  const today = await getToday();
  const soon = addDays(today, 90);
  const base = { institutionId };

  const [
    total,
    active,
    maturingSoon,
    overdue,
    pendingVerification,
    replaced,
    released,
    drafts,
    historical,
    exposure,
  ] = await Promise.all([
    prisma.instrument.count({ where: base }),
    prisma.instrument.count({ where: { ...base, lifecycleStatus: LIFECYCLE.ACTIVE } }),
    prisma.instrument.count({
      where: {
        ...base,
        lifecycleStatus: LIFECYCLE.ACTIVE,
        maturityDate: { gte: today, lte: soon },
      },
    }),
    prisma.instrument.count({
      where: { ...base, lifecycleStatus: LIFECYCLE.ACTIVE, maturityDate: { lt: today } },
    }),
    prisma.instrument.count({
      where: {
        ...base,
        lifecycleStatus: { notIn: [LIFECYCLE.REPLACED, LIFECYCLE.ARCHIVED, LIFECYCLE.CLOSED] },
        verificationStatus: {
          in: ["NOT_CHECKED", "NEEDS_REVIEW", "PENDING_EXTERNAL_VERIFICATION"],
        },
      },
    }),
    prisma.instrument.count({ where: { ...base, lifecycleStatus: LIFECYCLE.REPLACED } }),
    prisma.instrument.count({ where: { ...base, lifecycleStatus: LIFECYCLE.CLOSED } }),
    prisma.instrument.count({ where: { ...base, lifecycleStatus: LIFECYCLE.DRAFT } }),
    prisma.instrument.aggregate({ where: base, _sum: { amount: true } }),
    prisma.instrument.aggregate({
      where: { ...base, lifecycleStatus: LIFECYCLE.ACTIVE },
      _sum: { amount: true },
    }),
  ]);

  return {
    total,
    active,
    maturingSoon,
    overdue,
    pendingVerification,
    replaced,
    released,
    drafts,
    historicalAmount: Number(historical._sum.amount ?? 0),
    activeExposure: Number(exposure._sum.amount ?? 0),
  };
}

export async function getVisibleInstitution(user: SessionUser, id: string) {
  const institution = await prisma.institution.findFirst({
    where: { AND: [{ id }, institutionScope(user)] },
  });
  if (!institution) {
    if (await prisma.institution.findUnique({ where: { id }, select: { id: true } })) {
      throw forbidden("institution", id);
    }
    throw notFound();
  }
  return institution;
}

export async function listInstitutionFdrs(
  user: SessionUser,
  institutionId: string,
  params: { page?: number; pageSize?: number; status?: string },
) {
  const institution = await getVisibleInstitution(user, institutionId);
  const and: Prisma.InstrumentWhereInput[] = [{ institutionId: institution.id }];
  if (params.status && (Object.values(LIFECYCLE) as string[]).includes(params.status)) {
    and.push({ lifecycleStatus: params.status });
  }
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const [total, rows] = await Promise.all([
    prisma.instrument.count({ where: { AND: and } }),
    prisma.instrument.findMany({
      where: { AND: and },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

const UPDATABLE = ["name", "category", "state", "city", "aicteRef"] as const;

/** Institution edits are a system-admin action; duplicate identifiers are rejected server-side. */
export async function updateInstitution(
  user: SessionUser,
  id: string,
  body: Record<string, unknown>,
) {
  if (user.role !== ROLE.SYSTEM_ADMIN) throw forbidden("institution", id);

  const before = await prisma.institution.findUnique({ where: { id } });
  if (!before) throw notFound();

  const errors: { field: string; issue: string }[] = [];
  const data: Record<string, string> = {};
  for (const field of UPDATABLE) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (typeof raw !== "string" || !raw.trim()) {
      errors.push({ field, issue: `${field === "aicteRef" ? "Institution code" : "This field"} is required.` });
      continue;
    }
    const value = raw.trim();
    if (value.length > 160) {
      errors.push({ field, issue: "Use 160 characters or fewer." });
      continue;
    }
    data[field] = value;
  }
  if (data.aicteRef && data.aicteRef !== before.aicteRef) {
    const clash = await prisma.institution.findUnique({
      where: { aicteRef: data.aicteRef },
      select: { id: true },
    });
    if (clash) {
      errors.push({ field: "aicteRef", issue: "This institution code is already in use." });
    }
  }
  if (errors.length > 0) throw invalid("Check the highlighted fields.", errors);
  if (Object.keys(data).length === 0) {
    throw invalid("No changes were supplied.", []);
  }

  return auditTransaction(async (tx) => {
    const after = await tx.institution.update({ where: { id }, data });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "institution.updated",
      entityType: "institution",
      entityId: id,
      before: { name: before.name, aicteRef: before.aicteRef, category: before.category, state: before.state, city: before.city },
      after: { name: after.name, aicteRef: after.aicteRef, category: after.category, state: after.state, city: after.city },
    });
    return after;
  });
}
