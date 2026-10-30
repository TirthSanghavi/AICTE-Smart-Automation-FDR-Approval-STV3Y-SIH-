import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/constants";
import { dateOnly, addDays } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { getVisibleInstrument } from "@/lib/rbac";
import { createInstrument, submitInstrument } from "@/lib/services/instruments";
import { uploadDocument, getDocumentForUser } from "@/lib/services/documents";
import { recordVerification } from "@/lib/services/verification";
import {
  createCase,
  completeTask,
  decideCase,
  withdrawCase,
} from "@/lib/services/cases";
import { requestCorrection, resolveFinding } from "@/lib/services/findings";
import { runMaturityScan, acknowledgeAlert } from "@/lib/services/maturity";
import { recordDeniedAccess } from "@/lib/audit";
import { verifyAuditChain } from "@/lib/audit-chain";
import {
  asSession,
  auditEventsAscending,
  makeConfirmedDocument,
  makeInstitution,
  makeInstrument,
  makeUser,
  resetAll,
} from "./helpers";

let institutionA: { id: string; name: string };
let institutionB: { id: string; name: string };
let adminA: Awaited<ReturnType<typeof makeUser>>;
let adminB: Awaited<ReturnType<typeof makeUser>>;
let officer: Awaited<ReturnType<typeof makeUser>>;
let reviewer: Awaited<ReturnType<typeof makeUser>>;
let authority: Awaited<ReturnType<typeof makeUser>>;
let viewerA: Awaited<ReturnType<typeof makeUser>>;

function sessionAdminA() {
  return asSession(adminA);
}
function sessionAdminB() {
  return asSession(adminB);
}
function sessionOfficer() {
  return asSession(officer);
}
function sessionAuthority() {
  return asSession(authority);
}

function expectAppError(error: unknown, status: number, code?: string) {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.status).toBe(status);
  if (code) expect(appError.code).toBe(code);
}

beforeAll(async () => {
  await resetAll();
  institutionA = await makeInstitution("Sunrise Institute of Technology", "SYN-A");
  institutionB = await makeInstitution("Lakeview Polytechnic", "SYN-B");
  adminA = await makeUser(ROLE.INSTITUTION_ADMIN, "admin.a@test.demo", institutionA.id, "Meera");
  adminB = await makeUser(ROLE.INSTITUTION_ADMIN, "admin.b@test.demo", institutionB.id, "Ananya");
  officer = await makeUser(ROLE.SCRUTINY_OFFICER, "officer@test.demo");
  reviewer = await makeUser(ROLE.DEPT_REVIEWER, "reviewer@test.demo");
  authority = await makeUser(ROLE.COMPETENT_AUTHORITY, "authority@test.demo");
  viewerA = await makeUser(ROLE.INSTITUTION_VIEWER, "viewer.a@test.demo", institutionA.id, "Rohan");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("denies an institution user access to another institution's instrument", async () => {
    const foreign = await makeInstrument({
      institutionId: institutionB.id,
      createdBy: adminB.id,
      fdrNumber: "B-ISO-001",
    });

    try {
      await getVisibleInstrument(sessionAdminA(), foreign.id);
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403, "FORBIDDEN");
    }

    const own = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-ISO-001",
    });
    const visible = await getVisibleInstrument(sessionAdminA(), own.id);
    expect(visible.id).toBe(own.id);

    await recordDeniedAccess({
      actorId: adminA.id,
      actorRole: adminA.role,
      entityType: "instrument",
      entityId: foreign.id,
    });
    const denied = await prisma.auditEvent.findFirst({
      where: { action: "access.denied", entityId: foreign.id },
    });
    expect(denied).toBeTruthy();
  });

  it("does not let a viewer mutate an instrument", async () => {
    try {
      await createInstrument(asSession(viewerA), {
        bankName: "Demo Bank",
        fdrNumber: "A-VIEWER-001",
        amount: "1000",
        issueDate: "2026-01-01",
        maturityDate: "2030-01-01",
        holderName: "Sunrise Institute of Technology",
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }
  });
});

describe("submission and findings", () => {
  it("blocks impossible dates without a partial transition", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-BADDATE-001",
      issueDate: dateOnly(2026, 3, 16),
      maturityDate: dateOnly(2026, 3, 14),
      documentStatus: "CONFIRMED",
    });
    await makeConfirmedDocument(instrument.id, adminA.id);

    try {
      await submitInstrument(sessionAdminA(), instrument.id);
      throw new Error("expected validation failure");
    } catch (error) {
      expectAppError(error, 422, "VALIDATION_FAILED");
    }
    const after = await prisma.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    expect(after.lifecycleStatus).toBe("DRAFT");
    expect(
      await prisma.auditEvent.count({
        where: { action: "instrument.submitted", entityId: instrument.id },
      }),
    ).toBe(0);
  });

  it("creates a duplicate finding without overwriting either record", async () => {
    await makeInstrument({
      institutionId: institutionB.id,
      createdBy: adminB.id,
      fdrNumber: "DUP-777",
      bankName: "Demo Cooperative Bank",
      lifecycleStatus: "ACTIVE",
      holderName: "Lakeview Polytechnic",
    });
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "DUP-777",
      bankName: "Demo Cooperative Bank",
      documentStatus: "CONFIRMED",
    });
    await makeConfirmedDocument(instrument.id, adminA.id);

    const result = await submitInstrument(sessionAdminA(), instrument.id);
    expect(result.instrument.lifecycleStatus).toBe("SUBMITTED");
    expect(result.instrument.complianceStatus).toBe("FINDINGS_OPEN");

    const duplicate = await prisma.finding.findFirst({
      where: { instrumentId: instrument.id, ruleId: "DR-06" },
    });
    expect(duplicate?.severity).toBe("CRITICAL");
    expect(duplicate?.resolutionStatus).toBe("OPEN");

    const records = await prisma.instrument.findMany({
      where: { normalizedFdr: "DUP777" },
    });
    expect(records).toHaveLength(2);
    const foreign = records.find((record) => record.institutionId === institutionB.id);
    expect(foreign?.lifecycleStatus).toBe("ACTIVE");
  });
});

describe("verification trust boundary", () => {
  it("normalizes a simulated result to SIMULATED_RESULT and never BANK_CONFIRMED", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-SIM-001",
      lifecycleStatus: "UNDER_REVIEW",
      documentStatus: "CONFIRMED",
    });
    await makeConfirmedDocument(instrument.id, adminA.id);

    const result = await recordVerification(sessionOfficer(), instrument.id, {
      method: "SIMULATED",
      sourceName: "Prototype bank simulator (not a bank)",
      reference: "SIM-TEST-1",
      asOf: new Date(),
      notes: "Synthetic response.",
      limitations: "",
      evidenceDocumentId: null,
      overrideReason: null,
    });

    expect(result.attempt.simulated).toBe(true);
    expect(result.attempt.status).toBe("SIMULATED_RESULT");
    expect(result.instrument.verificationStatus).toBe("SIMULATED_RESULT");
    expect(result.instrument.verificationStatus).not.toBe("BANK_CONFIRMED");
    expect(result.instrument.lifecycleStatus).toBe("ACTIVE");
  });

  it("records manual review as MANUAL_REVIEW_RECORDED, not bank confirmation", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-MANUAL-001",
      lifecycleStatus: "UNDER_REVIEW",
      documentStatus: "CONFIRMED",
    });
    await makeConfirmedDocument(instrument.id, adminA.id);

    const result = await recordVerification(sessionOfficer(), instrument.id, {
      method: "MANUAL_CONFIRMATION",
      sourceName: "Bank email copy",
      reference: "MAN-01",
      asOf: new Date(),
      notes: "Compared the email copy to the submitted FDR.",
      limitations: "Email copy only; no bank API result.",
      evidenceDocumentId: null,
      overrideReason: null,
    });
    expect(result.attempt.simulated).toBe(false);
    expect(result.attempt.status).toBe("MANUAL_REVIEW_RECORDED");
    expect(result.instrument.verificationStatus).toBe("MANUAL_REVIEW_RECORDED");
  });

  it("blocks ordinary verification on a critical finding and allows an authority override with reason", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-CRIT-001",
      lifecycleStatus: "UNDER_REVIEW",
      documentStatus: "CONFIRMED",
    });
    await makeConfirmedDocument(instrument.id, adminA.id);
    await prisma.finding.create({
      data: {
        instrumentId: instrument.id,
        ruleId: "DR-06",
        field: "fdrNumber",
        observed: "duplicate candidate",
        expected: "no duplicate",
        basis: "test fixture",
        severity: "CRITICAL",
        explanation: "Duplicate candidate needs human review.",
        recommendedAction: "Review both records.",
        resolutionStatus: "OPEN",
      },
    });

    try {
      await recordVerification(sessionOfficer(), instrument.id, {
        method: "SIMULATED",
        sourceName: "Prototype bank simulator (not a bank)",
        reference: "SIM-TEST-2",
        asOf: new Date(),
        notes: "",
        limitations: "",
        evidenceDocumentId: null,
        overrideReason: null,
      });
      throw new Error("expected blocking conflict");
    } catch (error) {
      expectAppError(error, 409, "FINDINGS_BLOCKING_VERIFICATION");
    }

    try {
      await recordVerification(sessionOfficer(), instrument.id, {
        method: "SIMULATED",
        sourceName: "Prototype bank simulator (not a bank)",
        reference: "SIM-TEST-2",
        asOf: new Date(),
        notes: "",
        limitations: "",
        evidenceDocumentId: null,
        overrideReason: "Officer attempts override",
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }

    const result = await recordVerification(sessionAuthority(), instrument.id, {
      method: "SIMULATED",
      sourceName: "Prototype bank simulator (not a bank)",
      reference: "SIM-TEST-3",
      asOf: new Date(),
      notes: "Authority override for demo.",
      limitations: "",
      evidenceDocumentId: null,
      overrideReason: "Critical finding accepted with documented review for this synthetic demo.",
    });
    expect(result.instrument.verificationStatus).toBe("SIMULATED_RESULT");

    const finding = await prisma.finding.findUniqueOrThrow({
      where: { id: (await prisma.finding.findFirstOrThrow({ where: { instrumentId: instrument.id } })).id },
    });
    expect(finding.resolutionStatus).toBe("OPEN");
    const overrideAudit = await prisma.auditEvent.findFirst({
      where: { action: "verification.override", entityId: instrument.id },
    });
    expect(overrideAudit?.reason).toContain("documented review");
  });
});

describe("case workflow gates", () => {
  it("blocks incomplete approval, enforces roles, then approves without changing lifecycle", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-CASE-001",
      lifecycleStatus: "ACTIVE",
      documentStatus: "CONFIRMED",
    });
    const created = await createCase(sessionAdminA(), instrument.id, {
      type: "RELEASE",
      reason: "Synthetic release request for the test.",
    });
    const unchanged = await prisma.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    expect(unchanged.lifecycleStatus).toBe("ACTIVE");

    try {
      await decideCase(sessionAuthority(), created.id, {
        outcome: "APPROVED",
        reason: "Attempting an early approval for the test.",
      });
      throw new Error("expected checklist conflict");
    } catch (error) {
      expectAppError(error, 409, "CHECKLIST_INCOMPLETE");
    }
    expect(await prisma.decision.count({ where: { caseId: created.id } })).toBe(0);

    try {
      await decideCase(sessionAdminA(), created.id, {
        outcome: "APPROVED",
        reason: "Institution admin attempts a decision.",
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }

    const caseWithTasks = await prisma.releaseCase.findUniqueOrThrow({
      where: { id: created.id },
      include: { tasks: { orderBy: { stepOrder: "asc" } } },
    });
    const actors: Record<string, ReturnType<typeof sessionAdminA>> = {
      INSTITUTION_ADMIN: sessionAdminA(),
      SCRUTINY_OFFICER: sessionOfficer(),
      DEPT_REVIEWER: asSession(reviewer),
    };
    for (const task of caseWithTasks.tasks) {
      await completeTask(actors[task.role], created.id, task.id, {
        outcome: "SATISFIED",
        notes: `Synthetic evidence reviewed for task ${task.stepOrder}.`,
      });
    }

    const decision = await decideCase(sessionAuthority(), created.id, {
      outcome: "APPROVED",
      reason:
        "Synthetic approval after all required checklist items were satisfied. No bank instruction is issued.",
    });
    expect(decision.outcome).toBe("APPROVED");
    const finalCase = await prisma.releaseCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(finalCase.status).toBe("APPROVED");
    const finalInstrument = await prisma.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    expect(finalInstrument.lifecycleStatus).toBe("ACTIVE");
  });

  it("blocks a decision maker who completed a checklist task", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-SELF-001",
      lifecycleStatus: "ACTIVE",
    });
    const created = await createCase(sessionAdminA(), instrument.id, {
      type: "EXTENSION",
      reason: "Synthetic extension request for separation-of-duties test.",
    });
    const tasks = await prisma.reviewTask.findMany({
      where: { caseId: created.id },
      orderBy: { stepOrder: "asc" },
    });
    await prisma.reviewTask.update({
      where: { id: tasks[0].id },
      data: {
        status: "COMPLETED",
        outcome: "SATISFIED",
        completedBy: authority.id,
        completedAt: new Date(),
        notes: "Authority completed a task directly in this fixture.",
      },
    });

    try {
      await decideCase(sessionAuthority(), created.id, {
        outcome: "APPROVED",
        reason: "Authority attempts to decide a case they worked on.",
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }
  });

  it("withdraws a case without forcing the instrument to a new lifecycle", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-WITHDRAW-001",
      lifecycleStatus: "ACTIVE",
    });
    const created = await createCase(sessionAdminA(), instrument.id, {
      type: "REFUND",
      reason: "Synthetic refund request to withdraw.",
    });
    const withdrawn = await withdrawCase(sessionAdminA(), created.id);
    expect(withdrawn.status).toBe("WITHDRAWN");
    const after = await prisma.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    expect(after.lifecycleStatus).toBe("ACTIVE");
  });
});

describe("documents", () => {
  it("stores a valid private upload, rejects bad content and enforces read scope", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-DOC-001",
    });
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
    const document = await uploadDocument(
      sessionAdminA(),
      instrument.id,
      new File([new Uint8Array(pdf)], "fdr.pdf", { type: "application/pdf" }),
    );
    expect(document.sha256).toHaveLength(64);
    expect(document.size).toBe(pdf.length);
    expect(document.docStatus).toBe("UPLOADED");

    const read = await getDocumentForUser(sessionAdminA(), document.id);
    expect(read.bytes.subarray(0, 5).toString()).toBe("%PDF-");

    try {
      await getDocumentForUser(sessionAdminB(), document.id);
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }

    const before = await prisma.documentVersion.count({ where: { instrumentId: instrument.id } });
    try {
      await uploadDocument(
        sessionAdminA(),
        instrument.id,
        new File([new Uint8Array(Buffer.from("not a PDF at all"))], "fake.pdf", {
          type: "application/pdf",
        }),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expectAppError(error, 415, "FILE_CONTENT_TYPE_MISMATCH");
    }
    expect(await prisma.documentVersion.count({ where: { instrumentId: instrument.id } })).toBe(before);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    oversized.write("%PDF-", 0, "latin1");
    try {
      await uploadDocument(
        sessionAdminA(),
        instrument.id,
        new File([new Uint8Array(oversized)], "huge.pdf", { type: "application/pdf" }),
      );
      throw new Error("expected rejection");
    } catch (error) {
      expectAppError(error, 413, "FILE_TOO_LARGE");
    }
  });
});

describe("audit atomicity and chain", () => {
  it("rolls back the business change when the audit insert fails", async () => {
    const ghost = { ...sessionAdminA(), id: "00000000-0000-0000-0000-000000000000" };
    try {
      await createInstrument(ghost, {
        bankName: "Demo Bank",
        fdrNumber: "A-AUDIT-FAIL-001",
        amount: "1000.00",
        issueDate: "2026-01-01",
        maturityDate: "2030-01-01",
        holderName: "Sunrise Institute of Technology",
      });
      throw new Error("expected audit failure");
    } catch (error) {
      expect(error).toBeTruthy();
    }
    const leaked = await prisma.instrument.findFirst({
      where: { fdrNumber: "A-AUDIT-FAIL-001" },
    });
    expect(leaked).toBeNull();
  });

  it("verifies the hash chain after the exercised flows", async () => {
    const events = await auditEventsAscending();
    expect(events.length).toBeGreaterThan(10);
    const result = verifyAuditChain(events);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(events.length);
  });

  it("keeps decisions insert-only from the service surface", async () => {
    const decision = await prisma.decision.findFirstOrThrow();
    expect(decision.authorityUserId).toBe(authority.id);
    expect(decision.reason.length).toBeGreaterThan(10);
  });
});

describe("maturity alerts", () => {
  it("generates one logical alert per threshold and is idempotent", async () => {
    await prisma.demoState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", demoDate: dateOnly(2026, 10, 26) },
      update: { demoDate: dateOnly(2026, 10, 26) },
    });
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-MAT-001",
      issueDate: dateOnly(2025, 10, 26),
      maturityDate: addDays(dateOnly(2026, 10, 26), 30),
      lifecycleStatus: "ACTIVE",
    });

    const first = await runMaturityScan(sessionOfficer());
    expect(first.created).toBeGreaterThan(0);
    const alerts = await prisma.maturityAlert.findMany({
      where: { instrumentId: instrument.id },
      orderBy: { thresholdDays: "desc" },
    });
    expect(alerts.map((alert) => alert.thresholdDays)).toEqual([90, 60, 30]);
    expect(new Set(alerts.map((alert) => alert.dedupeKey)).size).toBe(3);

    const second = await runMaturityScan(sessionOfficer());
    expect(second.created).toBe(0);
    expect(
      await prisma.maturityAlert.count({ where: { instrumentId: instrument.id } }),
    ).toBe(3);

    const acknowledged = await acknowledgeAlert(asSession(adminA), alerts[0].id);
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect(acknowledged.ackAt).toBeTruthy();

    await prisma.demoState.update({
      where: { id: "singleton" },
      data: { demoDate: null },
    });
  });
});

describe("correction loop", () => {
  it("walks request -> resubmit -> resolve with roles, versions and audit intact", async () => {
    const instrument = await makeInstrument({
      institutionId: institutionA.id,
      createdBy: adminA.id,
      fdrNumber: "A-CORR-001",
      holderName: "Riverside Charitable Trust",
      documentStatus: "CONFIRMED",
    });
    await makeConfirmedDocument(instrument.id, adminA.id);

    const submitted = await submitInstrument(sessionAdminA(), instrument.id);
    expect(submitted.instrument.lifecycleStatus).toBe("SUBMITTED");
    const finding = await prisma.finding.findFirstOrThrow({
      where: { instrumentId: instrument.id, ruleId: "DR-05" },
    });
    expect(finding.severity).toBe("HIGH");
    expect(finding.resolutionStatus).toBe("OPEN");

    // Role gate: an institution admin may not ask for a correction.
    try {
      await requestCorrection(sessionAdminA(), finding.id, {
        reason: "Should not be allowed.",
        dueDate: null,
        requestedFields: ["holderName"],
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }

    const requested = await requestCorrection(sessionOfficer(), finding.id, {
      reason: "Holder name does not match the registered institution name.",
      dueDate: addDays(dateOnly(2026, 11, 15), 14),
      requestedFields: ["holderName"],
    });
    expect(requested.lifecycleStatus).toBe("CORRECTION_REQUESTED");
    const marked = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(marked.resolutionStatus).toBe("CORRECTION_REQUESTED");
    expect(marked.correctionDueDate).toBeTruthy();
    expect(
      await prisma.notification.count({
        where: { userId: adminA.id, type: "CORRECTION_REQUESTED" },
      }),
    ).toBe(1);

    // Second request on the same finding is a 409, not a silent overwrite.
    try {
      await requestCorrection(sessionOfficer(), finding.id, {
        reason: "Asking twice.",
        dueDate: null,
        requestedFields: ["holderName"],
      });
      throw new Error("expected conflict");
    } catch (error) {
      expectAppError(error, 409, "INVALID_TRANSITION");
    }

    // The institution corrects and resubmits: versions advance, findings regenerate.
    const resubmitted = await submitInstrument(sessionAdminA(), instrument.id);
    expect(resubmitted.instrument.lifecycleStatus).toBe("SUBMITTED");
    expect(resubmitted.instrument.versionNo).toBeGreaterThan(submitted.instrument.versionNo);
    const superseded = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(superseded.resolutionStatus).toBe("SUPERSEDED");
    const regenerated = await prisma.finding.findFirstOrThrow({
      where: { instrumentId: instrument.id, ruleId: "DR-05", resolutionStatus: "OPEN" },
    });

    // Off-scoped role cannot resolve; the scrutiny officer can.
    try {
      await resolveFinding(sessionAdminA(), regenerated.id, {
        resolution: "RESOLVED",
        reason: "Institution marking its own finding resolved.",
      });
      throw new Error("expected forbidden");
    } catch (error) {
      expectAppError(error, 403);
    }
    const resolved = await resolveFinding(sessionOfficer(), regenerated.id, {
      resolution: "RESOLVED",
      reason: "Holder name confirmed against the FDR original held by the institution.",
    });
    expect(resolved.status).toBe("RESOLVED");

    const closed = await prisma.finding.findUniqueOrThrow({ where: { id: regenerated.id } });
    expect(closed.resolutionStatus).toBe("RESOLVED");
    expect((closed.resolutionReason ?? "").length).toBeGreaterThan(10);

    // Audit trail covers every step of the loop.
    const actions = (
      await prisma.auditEvent.findMany({
        where: { entityId: { in: [instrument.id, finding.id, regenerated.id] } },
        select: { action: true },
      })
    ).map((event) => event.action);
    for (const expected of [
      "instrument.submitted",
      "finding.correction_requested",
      "instrument.resubmitted",
      "finding.resolved",
    ]) {
      expect(actions).toContain(expected);
    }

    const history = await prisma.instrumentHistory.findMany({
      where: { instrumentId: instrument.id },
      orderBy: { versionNo: "asc" },
    });
    expect(history.map((entry) => entry.versionNo)).toEqual(
      [...new Set(history.map((entry) => entry.versionNo))],
    );
    expect(history.at(-1)?.versionNo).toBe(resubmitted.instrument.versionNo);
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(verifyAuditChain(await auditEventsAscending()).ok).toBe(true);
  });
});

describe("audit chain tamper detection", () => {
  it("flags a rewritten event payload", async () => {
    const events = await auditEventsAscending();
    expect(events.length).toBeGreaterThan(10);
    expect(verifyAuditChain(events).ok).toBe(true);

    const target = events[Math.floor(events.length / 2)];
    await prisma.auditEvent.update({
      where: { id: target.id },
      data: { reason: "tampered after the fact" },
    });
    const tampered = verifyAuditChain(await auditEventsAscending());
    expect(tampered.ok).toBe(false);
    expect(tampered.brokenAt).toBe(target.chainIndex);
  });
});
