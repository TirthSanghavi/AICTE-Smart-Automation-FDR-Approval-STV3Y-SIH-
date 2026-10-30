import type { Prisma } from "@prisma/client";
import { notFound as pageNotFound } from "next/navigation";
import { prisma } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { getVisibleInstitution } from "./services/institutions";
import {
  CASE_OPEN_STATUSES,
  INSTITUTION_ROLES,
  ROLE,
  type Role,
} from "./constants";
import type { SessionUser } from "./auth";

export function isInstitutionRole(role: Role): boolean {
  return INSTITUTION_ROLES.includes(role);
}

export function canManageInstruments(role: Role): boolean {
  return role === ROLE.INSTITUTION_ADMIN;
}

export function canScrutinise(role: Role): boolean {
  return role === ROLE.SCRUTINY_OFFICER;
}

export function canDecideCases(role: Role): boolean {
  return role === ROLE.COMPETENT_AUTHORITY;
}

export function canViewAuditLog(role: Role): boolean {
  return role === ROLE.AUDITOR || role === ROLE.SYSTEM_ADMIN;
}

export function canViewRules(role: Role): boolean {
  return role !== ROLE.SERVICE_ACCOUNT;
}

/** Predicate for instrument reads. Institution roles are always tenant-scoped. */
export function instrumentScope(user: SessionUser): Prisma.InstrumentWhereInput {
  if (isInstitutionRole(user.role)) {
    if (!user.institutionId) return { id: "__no_institution__" };
    return { institutionId: user.institutionId };
  }
  if (user.role === ROLE.DEPT_REVIEWER) {
    return {
      releaseCases: {
        some: { tasks: { some: { role: ROLE.DEPT_REVIEWER } } },
      },
    };
  }
  if (user.role === ROLE.SERVICE_ACCOUNT) {
    return { id: "__service_account_no_ui__" };
  }
  return {};
}

export function caseScope(user: SessionUser): Prisma.ReleaseCaseWhereInput {
  if (isInstitutionRole(user.role)) {
    if (!user.institutionId) return { id: "__no_institution__" };
    return { institutionId: user.institutionId };
  }
  if (user.role === ROLE.DEPT_REVIEWER) {
    return { tasks: { some: { role: ROLE.DEPT_REVIEWER } } };
  }
  if (user.role === ROLE.SERVICE_ACCOUNT) {
    return { id: "__service_account_no_ui__" };
  }
  return {};
}

export async function getVisibleInstrument(user: SessionUser, id: string) {
  const instrument = await prisma.instrument.findFirst({
    where: { AND: [{ id }, instrumentScope(user)] },
    include: {
      institution: true,
      documents: { orderBy: { versionNo: "desc" } },
      findings: { orderBy: { createdAt: "desc" } },
      verificationAttempts: { orderBy: { createdAt: "desc" } },
      alerts: { orderBy: { sentAt: "desc" } },
      releaseCases: {
        orderBy: { createdAt: "desc" },
        include: { tasks: { orderBy: { stepOrder: "asc" } }, decisions: true },
      },
      history: { orderBy: { versionNo: "desc" } },
      replaces: {
        select: { id: true, fdrNumber: true, bankName: true, lifecycleStatus: true },
      },
      replacedBy: {
        select: { id: true, fdrNumber: true, bankName: true, lifecycleStatus: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      extractedFields: { where: { confirmedAt: { not: null } }, orderBy: { name: "asc" } },
    },
  });
  if (!instrument) {
    if (await prisma.instrument.findUnique({ where: { id }, select: { id: true } })) {
      throw forbidden("instrument", id);
    }
    throw notFound();
  }
  return instrument;
}

export async function getVisibleCase(user: SessionUser, id: string) {
  const releaseCase = await prisma.releaseCase.findFirst({
    where: { AND: [{ id }, caseScope(user)] },
    include: {
      instrument: { include: { institution: true } },
      institution: true,
      tasks: { orderBy: { stepOrder: "asc" } },
      clearances: { orderBy: { createdAt: "desc" } },
      decisions: { orderBy: { decidedAt: "desc" } },
    },
  });
  if (!releaseCase) {
    if (await prisma.releaseCase.findUnique({ where: { id }, select: { id: true } })) {
      throw forbidden("release_case", id);
    }
    throw notFound();
  }
  return releaseCase;
}

/**
 * Page loaders: a record that exists but is outside the viewer's scope, or a
 * record that does not exist, renders Next's 404 page instead of letting the
 * AppError bubble into a generic 500 "Application error" screen. API routes
 * keep the JSON contract (403 FORBIDDEN / 404 NOT_FOUND) via the route
 * error handler; browsers get one consistent 404 for both cases, so tenant
 * existence is never leaked through the UI.
 */
export async function loadInstrumentPage(user: SessionUser, id: string) {
  try {
    return await getVisibleInstrument(user, id);
  } catch (error) {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) {
      pageNotFound();
    }
    throw error;
  }
}

export async function loadCasePage(user: SessionUser, id: string) {
  try {
    return await getVisibleCase(user, id);
  } catch (error) {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) {
      pageNotFound();
    }
    throw error;
  }
}

export async function loadInstitutionPage(user: SessionUser, id: string) {
  try {
    return await getVisibleInstitution(user, id);
  } catch (error) {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) {
      pageNotFound();
    }
    throw error;
  }
}

export async function hasOpenCase(instrumentId: string, type?: string): Promise<boolean> {
  const count = await prisma.releaseCase.count({
    where: {
      instrumentId,
      ...(type ? { type } : {}),
      status: { in: CASE_OPEN_STATUSES },
    },
  });
  return count > 0;
}

export function severityRank(severity: string): number {
  switch (severity) {
    case "CRITICAL":
      return 4;
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    default:
      return 1;
  }
}
