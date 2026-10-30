import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { addDays, dateOnly } from "@/lib/dates";
import { getToday } from "@/lib/demo-clock";
import {
  getVisibleInstitution,
  institutionStats,
  listInstitutionFdrs,
  listInstitutions,
  updateInstitution,
} from "@/lib/services/institutions";
import {
  asSession,
  makeInstrument,
  makeInstitution,
  makeUser,
  resetAll,
} from "./helpers";

let sunrise: { id: string; name: string };
let lakeview: { id: string; name: string };
let admin: Awaited<ReturnType<typeof makeUser>>;
let adminB: Awaited<ReturnType<typeof makeUser>>;
let viewer: Awaited<ReturnType<typeof makeUser>>;
let officer: Awaited<ReturnType<typeof makeUser>>;
let sysadmin: Awaited<ReturnType<typeof makeUser>>;
let auditor: Awaited<ReturnType<typeof makeUser>>;

function expectAppError(error: unknown, status: number, code?: string) {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.status).toBe(status);
  if (code) expect(appError.code).toBe(code);
}

beforeAll(async () => {
  await resetAll();
  sunrise = await makeInstitution("Sunrise Institute of Technology", "SYN-INST-A");
  lakeview = await makeInstitution("Lakeview Polytechnic", "SYN-INST-B");
  // A third institution for pagination headroom.
  await prisma.institution.create({
    data: { name: "Ashoka College of Engineering", aicteRef: "SYN-INST-C", category: "Government", state: "Delhi", city: "New Delhi" },
  });
  admin = await makeUser(ROLE.INSTITUTION_ADMIN, "inst.admin@test.demo", sunrise.id, "Meera");
  adminB = await makeUser(ROLE.INSTITUTION_ADMIN, "inst.admin.b@test.demo", lakeview.id, "Ananya");
  viewer = await makeUser(ROLE.INSTITUTION_VIEWER, "inst.viewer@test.demo", sunrise.id, "Rohan");
  officer = await makeUser(ROLE.SCRUTINY_OFFICER, "inst.officer@test.demo");
  sysadmin = await makeUser(ROLE.SYSTEM_ADMIN, "inst.sysadmin@test.demo");
  auditor = await makeUser(ROLE.AUDITOR, "inst.auditor@test.demo");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("institution directory", () => {
  it("returns all institutions for internal roles and only the own record for institution roles", async () => {
    const officerView = await listInstitutions(asSession(officer), {});
    expect(officerView.total).toBe(3);

    const adminView = await listInstitutions(asSession(admin), {});
    expect(adminView.total).toBe(1);
    expect(adminView.rows[0].id).toBe(sunrise.id);

    const viewerView = await listInstitutions(asSession(viewer), {});
    expect(viewerView.total).toBe(1);

    const adminBView = await listInstitutions(asSession(adminB), {});
    expect(adminBView.total).toBe(1);
    expect(adminBView.rows[0].id).toBe(lakeview.id);
  });

  it("searches by name, code and city", async () => {
    const byName = await listInstitutions(asSession(officer), { q: "Lakeview" });
    expect(byName.total).toBe(1);
    expect(byName.rows[0].id).toBe(lakeview.id);

    const byCode = await listInstitutions(asSession(officer), { q: "syn-inst-c" });
    expect(byCode.total).toBe(1);
    expect(byCode.rows[0].name).toBe("Ashoka College of Engineering");

    const byCity = await listInstitutions(asSession(officer), { q: "New Delhi" });
    expect(byCity.total).toBe(1);

    const noMatch = await listInstitutions(asSession(officer), { q: "zzz-no-such" });
    expect(noMatch.total).toBe(0);
    expect(noMatch.rows).toEqual([]);
  });

  it("paginates without skipping or repeating rows", async () => {
    const page1 = await listInstitutions(asSession(officer), { page: 1, pageSize: 2, sort: "name", dir: "asc" });
    const page2 = await listInstitutions(asSession(officer), { page: 2, pageSize: 2, sort: "name", dir: "asc" });
    expect(page1.rows.length).toBe(2);
    expect(page2.rows.length).toBe(1);
    expect(page1.pageCount).toBe(2);
    const ids = [...page1.rows, ...page2.rows].map((row) => row.id);
    expect(new Set(ids).size).toBe(3);
    const sorted = [...ids];
    expect(sorted).toBeTruthy();

    // Out-of-range page yields an empty page rather than an error.
    const beyond = await listInstitutions(asSession(officer), { page: 99, pageSize: 2 });
    expect(beyond.rows).toEqual([]);
    expect(beyond.total).toBe(3);
  });

  it("filters by category and state and exposes facet options", async () => {
    const govt = await listInstitutions(asSession(officer), { category: "Government" });
    expect(govt.total).toBe(1);
    expect(govt.rows[0].name).toBe("Ashoka College of Engineering");

    const maharashtra = await listInstitutions(asSession(officer), { state: "Maharashtra" });
    expect(maharashtra.total).toBe(2);

    const facets = await listInstitutions(asSession(officer), {});
    expect(facets.facets.categories).toContain("Government");
    expect(facets.facets.states).toContain("Delhi");
  });

  it("sorts by the requested column and direction", async () => {
    const asc = await listInstitutions(asSession(officer), { sort: "name", dir: "asc" });
    expect(asc.rows.map((r) => r.name)).toEqual([
      "Ashoka College of Engineering",
      "Lakeview Polytechnic",
      "Sunrise Institute of Technology",
    ]);
    const desc = await listInstitutions(asSession(officer), { sort: "name", dir: "desc" });
    expect(desc.rows[0].name).toBe("Sunrise Institute of Technology");
    // Unknown sort keys fall back to the default rather than erroring.
    const fallback = await listInstitutions(asSession(officer), { sort: "evil;drop", dir: "asc" });
    expect(fallback.rows.map((r) => r.name)).toEqual(asc.rows.map((r) => r.name));
  });
});

describe("institution profile access", () => {
  it("allows internal roles and the owning tenant, denies other tenants, 404s unknown ids", async () => {
    const visible = await getVisibleInstitution(asSession(officer), sunrise.id);
    expect(visible.id).toBe(sunrise.id);

    const own = await getVisibleInstitution(asSession(admin), sunrise.id);
    expect(own.id).toBe(sunrise.id);

    await expect(getVisibleInstitution(asSession(admin), lakeview.id)).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 403, "FORBIDDEN");
        return true;
      },
    );
    await expect(getVisibleInstitution(asSession(officer), "no-such-id")).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 404, "NOT_FOUND");
        return true;
      },
    );
  });

  it("scopes the institution FDR list the same way", async () => {
    await makeInstrument({ institutionId: sunrise.id, createdBy: admin.id, fdrNumber: "INST-A-1" });
    await makeInstrument({ institutionId: lakeview.id, createdBy: adminB.id, fdrNumber: "INST-B-1" });

    const own = await listInstitutionFdrs(asSession(admin), sunrise.id, {});
    expect(own.total).toBe(1);
    expect(own.rows[0].fdrNumber).toBe("INST-A-1");

    await expect(listInstitutionFdrs(asSession(admin), lakeview.id, {})).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 403, "FORBIDDEN");
        return true;
      },
    );
  });
});

describe("institution statistics", () => {
  it("derives every counter from records and never double-counts replacements", async () => {
    const inst = await makeInstitution("Stats Poly", "SYN-STATS");
    const user = await makeUser(ROLE.INSTITUTION_ADMIN, "stats.admin@test.demo", inst.id);
    const today = await getToday();

    // ACTIVE maturing (30 days), ACTIVE upcoming, ACTIVE overdue, REPLACED, CLOSED, DRAFT
    await makeInstrument({ institutionId: inst.id, createdBy: user.id, fdrNumber: "S-MAT", lifecycleStatus: "ACTIVE", maturityDate: addDays(today, 30), amount: 1_000_000 });
    await makeInstrument({ institutionId: inst.id, createdBy: user.id, fdrNumber: "S-UP", lifecycleStatus: "ACTIVE", maturityDate: addDays(today, 400), amount: 2_000_000 });
    await makeInstrument({ institutionId: inst.id, createdBy: user.id, fdrNumber: "S-OVER", lifecycleStatus: "ACTIVE", maturityDate: addDays(today, -10), amount: 500_000 });
    const predecessor = await makeInstrument({ institutionId: inst.id, createdBy: user.id, fdrNumber: "S-OLD", lifecycleStatus: "REPLACED", amount: 750_000 });
    await makeInstrument({ institutionId: inst.id, createdBy: user.id, fdrNumber: "S-REL", lifecycleStatus: "CLOSED", amount: 250_000 });
    await makeInstrument({ institutionId: inst.id, createdBy: user.id, fdrNumber: "S-DRAFT", amount: 100 });

    // Link a real successor to the replaced predecessor (amount counted once each side).
    await prisma.instrument.create({
      data: {
        institutionId: inst.id,
        bankName: "Demo Cooperative Bank",
        normalizedBank: "democooperativebank",
        fdrNumber: "S-NEW",
        normalizedFdr: "SNEW",
        amount: 750_000,
        issueDate: dateOnly(2026, 1, 1),
        maturityDate: addDays(today, 300),
        holderName: "Stats Poly",
        lifecycleStatus: "ACTIVE",
        createdBy: user.id,
        replacesId: predecessor.id,
        versionNo: 1,
      },
    });

    const stats = await institutionStats(inst.id);
    expect(stats.total).toBe(7);
    expect(stats.active).toBe(4); // S-MAT, S-UP, S-OVER, S-NEW
    expect(stats.maturingSoon).toBe(1); // S-MAT
    expect(stats.overdue).toBe(1); // S-OVER
    expect(stats.replaced).toBe(1);
    expect(stats.released).toBe(1);
    expect(stats.drafts).toBe(1);
    expect(stats.pendingVerification).toBeGreaterThanOrEqual(5); // all non-terminal NOT_CHECKED
    // Exposure: ACTIVE only → 1,000,000 + 2,000,000 + 500,000 + 750,000.
    expect(stats.activeExposure).toBe(4_250_000);
    // Historical ledger includes replaced + released + draft but is labelled separately.
    expect(stats.historicalAmount).toBe(5_250_100);
    // The replaced predecessor's 750,000 appears in the ledger but NOT in exposure twice.
    expect(stats.activeExposure).toBeLessThan(stats.historicalAmount);
  });

  it("returns zeroes for an institution with no records", async () => {
    const empty = await makeInstitution("Empty Institute", "SYN-EMPTY");
    const stats = await institutionStats(empty.id);
    expect(stats).toMatchObject({
      total: 0,
      active: 0,
      maturingSoon: 0,
      overdue: 0,
      pendingVerification: 0,
      replaced: 0,
      released: 0,
      drafts: 0,
      historicalAmount: 0,
      activeExposure: 0,
    });
  });
});

describe("institution updates", () => {
  it("lets only the system admin edit and records an audit event", async () => {
    const target = await makeInstitution("Editable Institute", "SYN-EDIT");

    await expect(
      updateInstitution(asSession(admin), target.id, { name: "Hacked" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });
    await expect(
      updateInstitution(asSession(officer), target.id, { name: "Hacked" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });

    const updated = await updateInstitution(asSession(sysadmin), target.id, {
      name: "Editable Institute of Technology",
      city: "Pune",
    });
    expect(updated.name).toBe("Editable Institute of Technology");
    expect(updated.city).toBe("Pune");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "institution.updated", entityId: target.id },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(sysadmin.id);
  });

  it("rejects duplicate institution codes and missing fields server-side", async () => {
    const target = await makeInstitution("Dupe Check Institute", "SYN-DUPE-1");
    await makeInstitution("Already Taken Institute", "SYN-DUPE-2");

    await expect(
      updateInstitution(asSession(sysadmin), target.id, { aicteRef: "SYN-DUPE-2" }),
    ).rejects.toSatisfy((error: unknown) => {
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect((appError.details ?? []).some((d) => d.field === "aicteRef")).toBe(true);
      return true;
    });

    // Unchanged unique code is fine (self, not a conflict).
    const same = await updateInstitution(asSession(sysadmin), target.id, {
      aicteRef: "SYN-DUPE-1",
    });
    expect(same.aicteRef).toBe("SYN-DUPE-1");

    await expect(
      updateInstitution(asSession(sysadmin), target.id, { name: "   " }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 422, "VALIDATION_FAILED");
      return true;
    });
    await expect(
      updateInstitution(asSession(sysadmin), target.id, {}),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 422, "VALIDATION_FAILED");
      return true;
    });
    await expect(
      updateInstitution(asSession(sysadmin), "no-such", { name: "X" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 404, "NOT_FOUND");
      return true;
    });
  });

  it("auditor can view but not modify", async () => {
    const target = await makeInstitution("Auditor View Institute", "SYN-AUD");
    const visible = await getVisibleInstitution(asSession(auditor), target.id);
    expect(visible.id).toBe(target.id);
    await expect(
      updateInstitution(asSession(auditor), target.id, { name: "Nope" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });
  });
});
