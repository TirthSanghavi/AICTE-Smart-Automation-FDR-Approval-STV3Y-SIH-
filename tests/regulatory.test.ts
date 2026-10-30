import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ENDORSEMENT, HOLDER_STRUCTURE_CONFIG, ROLE } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { isValidIfsc, normalizeIfsc, validateInstrumentInput } from "@/lib/validation";
import { recordEndorsement, getEndorsement } from "@/lib/services/endorsements";
import { createInstrument, updateInstrument } from "@/lib/services/instruments";
import { verifyAuditChain } from "@/lib/audit-chain";
import {
  asSession,
  auditEventsAscending,
  makeInstrument,
  makeInstitution,
  makeUser,
  resetAll,
} from "./helpers";

let institution: { id: string };
let otherInstitution: { id: string };
let admin: Awaited<ReturnType<typeof makeUser>>;
let otherAdmin: Awaited<ReturnType<typeof makeUser>>;
let viewer: Awaited<ReturnType<typeof makeUser>>;
let officer: Awaited<ReturnType<typeof makeUser>>;
let authority: Awaited<ReturnType<typeof makeUser>>;
let reviewer: Awaited<ReturnType<typeof makeUser>>;

function expectAppError(error: unknown, status: number, code?: string) {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.status).toBe(status);
  if (code) expect(appError.code).toBe(code);
}

const validBody = {
  bankName: "Demo Cooperative Bank",
  fdrNumber: "IFSC-FDR-1",
  amount: "1000000",
  issueDate: "2026-01-01",
  maturityDate: "2031-01-01",
  holderName: "Sunrise Institute of Technology",
  declaredLienStatus: "UNKNOWN",
};

beforeAll(async () => {
  await resetAll();
  institution = await makeInstitution("Sunrise Institute of Technology", "SYN-REG");
  otherInstitution = await makeInstitution("Lakeview Polytechnic", "SYN-REG-B");
  admin = await makeUser(ROLE.INSTITUTION_ADMIN, "reg.admin@test.demo", institution.id, "Meera");
  otherAdmin = await makeUser(ROLE.INSTITUTION_ADMIN, "reg.admin.b@test.demo", otherInstitution.id, "Ananya");
  viewer = await makeUser(ROLE.INSTITUTION_VIEWER, "reg.viewer@test.demo", institution.id, "Rohan");
  officer = await makeUser(ROLE.SCRUTINY_OFFICER, "reg.officer@test.demo", null, "Officer Isha");
  authority = await makeUser(ROLE.COMPETENT_AUTHORITY, "reg.authority@test.demo", null, "Authority Karan");
  reviewer = await makeUser(ROLE.DEPT_REVIEWER, "reg.reviewer@test.demo", null, "Reviewer Ravi");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("IFSC format validation", () => {
  it("accepts well-formed IFSC codes and normalizes case and whitespace", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("ICIC0000001")).toBe(true);
    expect(isValidIfsc("PUNB0123456")).toBe(true);
    expect(isValidIfsc("hdfc0001234")).toBe(true); // normalized to upper case
    expect(isValidIfsc("  hdfc 0001234 ")).toBe(true); // trimmed + inner spaces removed
    expect(normalizeIfsc(" hdfc0001234 ")).toBe("HDFC0001234");
  });

  it("rejects malformed codes with a clear explanation", () => {
    const cases = [
      "", // empty handled as "not provided" elsewhere; pattern rejects it
      "HDFC001234", // 10 chars
      "HDFC00012345", // 12 chars
      "ABCD1234567", // 5th char must be 0
      "ABC10001234", // only 3 leading letters
      "HDFC-001234", // symbol instead of 0/alnum
      "1DFC0001234", // digit in first block
      "HDFC000123@", // symbol in tail
    ];
    for (const candidate of cases) {
      expect(isValidIfsc(candidate), candidate).toBe(false);
    }
  });

  it("integrates with instrument validation on both optional-absent and invalid input", () => {
    const absent = validateInstrumentInput(validBody);
    expect(absent.errors).toEqual([]);
    expect(absent.value?.ifscCode).toBeNull();

    const valid = validateInstrumentInput({ ...validBody, ifscCode: "hdfc0001234" });
    expect(valid.errors).toEqual([]);
    expect(valid.value?.ifscCode).toBe("HDFC0001234");

    const invalid = validateInstrumentInput({ ...validBody, ifscCode: "NOPE" });
    const ifscError = invalid.errors.find((error) => error.field === "ifscCode");
    expect(ifscError).toBeTruthy();
    expect(ifscError?.issue).toContain("Format only");
    expect(invalid.value).toBeUndefined();
  });

  it("persists a normalized IFSC through create and update, and rejects invalid ones server-side", async () => {
    const created = await createInstrument(asSession(admin), {
      ...validBody,
      fdrNumber: "IFSC-CREATE-1",
      ifscCode: "utkb0001234",
    });
    expect(created.ifscCode).toBe("UTKB0001234");

    const updated = await updateInstrument(asSession(admin), created.id, {
      expectedVersion: created.versionNo,
      ifscCode: "hdfc0001234",
    });
    expect(updated.ifscCode).toBe("HDFC0001234");

    await expect(
      updateInstrument(asSession(admin), created.id, {
        expectedVersion: updated.versionNo,
        ifscCode: "BAD-CODE",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect((appError.details ?? []).some((detail) => detail.field === "ifscCode")).toBe(true);
      return true;
    });
  });

  it("never claims live validation: the configured boundary is format-only", () => {
    // Guards against someone silently upgrading the claim. A real directory
    // lookup must be an explicit, documented integration change.
    expect(HOLDER_STRUCTURE_CONFIG.mode).toBe("SEPARATE_ENDORSEMENT");
    expect(isValidIfsc("ZZZZ0000000")).toBe(true); // format passes; branch existence is NOT checked
  });
});

describe("AICTE officer endorsement", () => {
  it("models the endorsement separately from joint holding (explicit configuration)", () => {
    expect(HOLDER_STRUCTURE_CONFIG.aicteJointHolder).toBe(false);
    expect(HOLDER_STRUCTURE_CONFIG.requiredForSubmission).toBe(false);
  });

  it("starts with no endorsement and lets the institution request it", async () => {
    const instrument = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "END-1",
      lifecycleStatus: "ACTIVE",
    });
    expect(await getEndorsement(instrument.id)).toBeNull();

    const row = await recordEndorsement(asSession(admin), instrument.id, {
      status: ENDORSEMENT.PENDING,
      remarks: "Endorsement needed for the renewal submission.",
    });
    expect(row.status).toBe("PENDING");
    expect(row.endorsedAt).toBeNull();

    const withdrawn = await recordEndorsement(asSession(admin), instrument.id, {
      status: ENDORSEMENT.WITHDRAWN,
    });
    expect(withdrawn.status).toBe("WITHDRAWN");
  });

  it("blocks institutions from self-endorsing; officers and authority may endorse", async () => {
    const instrument = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "END-2",
      lifecycleStatus: "ACTIVE",
    });

    await expect(
      recordEndorsement(asSession(admin), instrument.id, {
        status: ENDORSEMENT.ENDORSED,
        officerName: "Self Approved",
        officerReference: "FAKE-1",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });
    await expect(
      recordEndorsement(asSession(viewer), instrument.id, { status: ENDORSEMENT.PENDING }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });
    await expect(
      recordEndorsement(asSession(reviewer), instrument.id, {
        status: ENDORSEMENT.ENDORSED,
        officerName: "Reviewer",
        officerReference: "R-1",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });

    const endorsed = await recordEndorsement(asSession(officer), instrument.id, {
      status: ENDORSEMENT.ENDORSED,
      officerName: "Officer Isha",
      officerReference: "JD (Security) · AUTH-2026-001",
      documentRef: "OM-2026-77",
      remarks: "Verified against the sanction letter.",
    });
    expect(endorsed.status).toBe("ENDORSED");
    expect(endorsed.endorsedAt).toBeTruthy();
    expect(endorsed.officerName).toBe("Officer Isha");

    // Authority can also record a decision on another instrument.
    const second = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "END-3",
      lifecycleStatus: "ACTIVE",
    });
    const byAuthority = await recordEndorsement(asSession(authority), second.id, {
      status: ENDORSEMENT.ENDORSED,
      officerName: "Authority Karan",
      officerReference: "CA-2026-9",
    });
    expect(byAuthority.status).toBe("ENDORSED");
  });

  it("requires officer identity for endorsements and a reason for refusals", async () => {
    const instrument = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "END-4",
      lifecycleStatus: "ACTIVE",
    });

    await expect(
      recordEndorsement(asSession(officer), instrument.id, { status: ENDORSEMENT.ENDORSED }),
    ).rejects.toSatisfy((error: unknown) => {
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      const fields = (appError.details ?? []).map((detail) => detail.field);
      expect(fields).toContain("officerName");
      expect(fields).toContain("officerReference");
      return true;
    });

    await expect(
      recordEndorsement(asSession(officer), instrument.id, { status: ENDORSEMENT.REJECTED }),
    ).rejects.toSatisfy((error: unknown) => {
      const appError = error as AppError;
      expect(appError.status).toBe(422);
      expect((appError.details ?? []).map((detail) => detail.field)).toContain("remarks");
      return true;
    });

    const refused = await recordEndorsement(asSession(officer), instrument.id, {
      status: ENDORSEMENT.REJECTED,
      remarks: "Sanction letter reference does not match the submitted record.",
    });
    expect(refused.status).toBe("REJECTED");
    expect(refused.remarks).toContain("Sanction letter");
  });

  it("rejects unknown statuses, unknown instruments and foreign-tenant instruments", async () => {
    const instrument = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "END-5",
      lifecycleStatus: "ACTIVE",
    });

    await expect(
      recordEndorsement(asSession(officer), instrument.id, { status: "APPROVED_MAYBE" }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 422, "VALIDATION_FAILED");
      return true;
    });
    await expect(
      recordEndorsement(asSession(officer), "no-such-id", { status: ENDORSEMENT.NOT_REQUIRED }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 404, "NOT_FOUND");
      return true;
    });
    await expect(
      recordEndorsement(asSession(otherAdmin), instrument.id, {
        status: ENDORSEMENT.PENDING,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, "FORBIDDEN");
      return true;
    });
  });

  it("preserves audit history: endorsement transitions are chained and the chain still verifies", async () => {
    const instrument = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "END-6",
      lifecycleStatus: "ACTIVE",
    });

    await recordEndorsement(asSession(admin), instrument.id, { status: ENDORSEMENT.PENDING });
    await recordEndorsement(asSession(officer), instrument.id, {
      status: ENDORSEMENT.ENDORSED,
      officerName: "Officer Isha",
      officerReference: "JD-2026-2",
    });

    const events = await prisma.auditEvent.findMany({
      where: { action: "endorsement.recorded" },
      orderBy: { chainIndex: "asc" },
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].before).toBeNull(); // first-ever endorsement has no predecessor row
    expect(events[events.length - 1].before).toContain("PENDING");
    expect(events[events.length - 1].after).toContain("ENDORSED");

    const chain = verifyAuditChain(await auditEventsAscending());
    expect(chain.ok).toBe(true);
  });
});
