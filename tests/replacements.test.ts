import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { replaceInstrument, replacementEligible } from "@/lib/services/replacements";
import { recordDeniedAccess } from "@/lib/audit";
import {
  asSession,
  makeConfirmedDocument,
  makeInstitution,
  makeInstrument,
  makeUser,
  resetAll,
} from "./helpers";

let institution: { id: string; name: string };
let otherInstitution: { id: string; name: string };
let admin: Awaited<ReturnType<typeof makeUser>>;
let otherAdmin: Awaited<ReturnType<typeof makeUser>>;
let viewer: Awaited<ReturnType<typeof makeUser>>;
let officer: Awaited<ReturnType<typeof makeUser>>;

const replacementBody = {
  bankName: "Demo Cooperative Bank",
  branch: "Pune Camp",
  fdrNumber: "REPL-001",
  amount: "1500000",
  issueDate: "2036-02-01",
  maturityDate: "2041-02-01",
  holderName: "Sunrise Institute of Technology",
  declaredLienStatus: "UNKNOWN",
  reason: "Deposit renewed at maturity for a fresh five-year term.",
};

function expectAppError(error: unknown, status: number, code?: string) {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.status).toBe(status);
  if (code) expect(appError.code).toBe(code);
}

beforeAll(async () => {
  await resetAll();
  institution = await makeInstitution("Sunrise Institute of Technology", "SYN-A");
  otherInstitution = await makeInstitution("Lakeview Polytechnic", "SYN-B");
  admin = await makeUser(ROLE.INSTITUTION_ADMIN, "repl.admin@test.demo", institution.id, "Meera");
  otherAdmin = await makeUser(ROLE.INSTITUTION_ADMIN, "repl.admin.b@test.demo", otherInstitution.id, "Ananya");
  viewer = await makeUser(ROLE.INSTITUTION_VIEWER, "repl.viewer@test.demo", institution.id, "Rohan");
  officer = await makeUser(ROLE.SCRUTINY_OFFICER, "repl.officer@test.demo");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("replacement workflow", () => {
  it("creates a linked successor and marks the predecessor REPLACED in one operation", async () => {
    const predecessor = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "ORIG-001",
      lifecycleStatus: "ACTIVE",
    });

    const successor = await replaceInstrument(asSession(admin), predecessor.id, replacementBody);

    expect(successor.replacesId).toBe(predecessor.id);
    expect(successor.replacementReason).toBe(replacementBody.reason);
    expect(successor.lifecycleStatus).toBe("DRAFT");
    expect(successor.institutionId).toBe(institution.id);

    const refreshed = await prisma.instrument.findUniqueOrThrow({
      where: { id: predecessor.id },
      include: { replacedBy: true },
    });
    expect(refreshed.lifecycleStatus).toBe("REPLACED");
    expect(refreshed.replacedAt).toBeTruthy();
    expect(refreshed.replacedById).toBe(admin.id);
    expect(refreshed.replacedBy.map((r) => r.id)).toEqual([successor.id]);
    // Original details untouched.
    expect(refreshed.fdrNumber).toBe("ORIG-001");
    expect(refreshed.amount.toString()).toBe("1000000");

    const history = await prisma.instrumentHistory.findMany({
      where: { instrumentId: { in: [predecessor.id, successor.id] } },
      orderBy: { changedAt: "asc" },
    });
    expect(history.some((h) => h.reason === `Replaced by ${successor.fdrNumber}`)).toBe(true);
    expect(history.some((h) => h.reason === `Replacement for ${predecessor.fdrNumber}`)).toBe(true);

    const audits = await prisma.auditEvent.findMany({
      where: { action: { in: ["instrument.replaced", "instrument.replacement_created"] } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      "instrument.replaced",
      "instrument.replacement_created",
    ]);
  });

  it("preserves the predecessor's documents, findings and verification records", async () => {
    const predecessor = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "ORIG-002",
      lifecycleStatus: "ACTIVE",
    });
    await makeConfirmedDocument(predecessor.id, admin.id);
    await prisma.finding.create({
      data: {
        instrumentId: predecessor.id,
        ruleId: "DR-02",
        severity: "INFO",
        explanation: "existing finding",
        recommendedAction: "n/a",
      },
    });
    await prisma.verificationAttempt.create({
      data: {
        instrumentId: predecessor.id,
        method: "MANUAL",
        status: "MANUAL_REVIEW_RECORDED",
        sourceName: "Letter",
        asOf: new Date(),
      },
    });

    await replaceInstrument(asSession(admin), predecessor.id, {
      ...replacementBody,
      fdrNumber: "REPL-002",
    });

    const docs = await prisma.documentVersion.count({ where: { instrumentId: predecessor.id } });
    const findings = await prisma.finding.count({ where: { instrumentId: predecessor.id } });
    const verifications = await prisma.verificationAttempt.count({
      where: { instrumentId: predecessor.id },
    });
    expect(docs).toBe(1);
    expect(findings).toBe(1);
    expect(verifications).toBe(1);
  });

  it("rejects draft, archived and already-replaced predecessors", async () => {
    const draft = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "REPL-DRAFT",
    });
    await expect(
      replaceInstrument(asSession(admin), draft.id, replacementBody),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 409, "INVALID_TRANSITION");
      return true;
    });

    const active = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "REPL-TWICE",
      lifecycleStatus: "ACTIVE",
    });
    const successor = await replaceInstrument(asSession(admin), active.id, {
      ...replacementBody,
      fdrNumber: "REPL-TWICE-NEW",
    });
    await expect(
      replaceInstrument(asSession(admin), active.id, {
        ...replacementBody,
        fdrNumber: "REPL-TWICE-NEW-2",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 409, "ALREADY_REPLACED");
      return true;
    });
    const successors = await prisma.instrument.count({ where: { replacesId: active.id } });
    expect(successors).toBe(1);

    // The successor itself is a draft, so the chain cannot be inverted or cycled.
    expect(replacementEligible(successor.lifecycleStatus, 0)).toBe(false);
  });

  it("does not let another institution replace the record", async () => {
    const foreign = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "REPL-ISO",
      lifecycleStatus: "ACTIVE",
    });
    await expect(
      replaceInstrument(asSession(otherAdmin), foreign.id, replacementBody),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });
    const refreshed = await prisma.instrument.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(refreshed.lifecycleStatus).toBe("ACTIVE");

    await recordDeniedAccess({
      actorId: otherAdmin.id,
      actorRole: otherAdmin.role,
      entityType: "instrument",
      entityId: foreign.id,
    });
    const denied = await prisma.auditEvent.findFirst({
      where: { action: "access.denied", entityId: foreign.id },
    });
    expect(denied).toBeTruthy();
  });

  it("denies viewers and officers (replacement is an institution-admin action)", async () => {
    const target = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "REPL-AUTH",
      lifecycleStatus: "ACTIVE",
    });
    for (const session of [asSession(viewer), asSession(officer)]) {
      await expect(
        replaceInstrument(session, target.id, replacementBody),
      ).rejects.toSatisfy((error: unknown) => {
        expectAppError(error, 403, "FORBIDDEN");
        return true;
      });
    }
    const refreshed = await prisma.instrument.findUniqueOrThrow({ where: { id: target.id } });
    expect(refreshed.lifecycleStatus).toBe("ACTIVE");
  });

  it("requires a meaningful reason and valid instrument fields", async () => {
    const target = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "REPL-VALID",
      lifecycleStatus: "ACTIVE",
    });
    await expect(
      replaceInstrument(asSession(admin), target.id, { ...replacementBody, reason: "x" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 422, "VALIDATION_FAILED");
      return true;
    });
    await expect(
      replaceInstrument(asSession(admin), target.id, {
        ...replacementBody,
        fdrNumber: "",
        maturityDate: "2030-01-01",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect((appError.details ?? []).length).toBeGreaterThanOrEqual(2);
      return true;
    });
    const untouched = await prisma.instrument.findUniqueOrThrow({ where: { id: target.id } });
    expect(untouched.lifecycleStatus).toBe("ACTIVE");
  });

  it("allows exactly one of two concurrent replacement attempts to succeed", async () => {
    const predecessor = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "REPL-RACE",
      lifecycleStatus: "ACTIVE",
    });
    const session = asSession(admin);

    const results = await Promise.allSettled([
      replaceInstrument(session, predecessor.id, { ...replacementBody, fdrNumber: "RACE-1" }),
      replaceInstrument(session, predecessor.id, { ...replacementBody, fdrNumber: "RACE-2" }),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBe(1);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed.length).toBe(1);
    expectAppError(failed[0].reason, 409, "ALREADY_REPLACED");

    const successors = await prisma.instrument.count({ where: { replacesId: predecessor.id } });
    expect(successors).toBe(1);
    const refreshed = await prisma.instrument.findUniqueOrThrow({ where: { id: predecessor.id } });
    expect(refreshed.lifecycleStatus).toBe("REPLACED");
  });
});
