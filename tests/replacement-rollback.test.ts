import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/constants";
import { replaceInstrument } from "@/lib/services/replacements";
import { asSession, makeInstitution, makeInstrument, makeUser, resetAll } from "./helpers";

/**
 * Rollback coverage: the appendAudit for the successor runs as the LAST step
 * inside the replacement transaction, so forcing it to throw must roll back
 * the predecessor status flip, the successor row and every history entry.
 */
const failAction = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    appendAudit: async (tx: Parameters<typeof actual.appendAudit>[0], input: Parameters<typeof actual.appendAudit>[1]) => {
      if (failAction.value === input.action) throw new Error("forced failure");
      return actual.appendAudit(tx, input);
    },
  };
});

let institution: { id: string };
let admin: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  await resetAll();
  institution = await makeInstitution("Sunrise Institute of Technology", "SYN-RB");
  admin = await makeUser(ROLE.INSTITUTION_ADMIN, "rollback.admin@test.demo", institution.id, "Meera");
});

afterAll(async () => {
  failAction.value = null;
  await prisma.$disconnect();
});

describe("replacement rollback", () => {
  it("leaves no partial records when a later step in the transaction fails", async () => {
    const predecessor = await makeInstrument({
      institutionId: institution.id,
      createdBy: admin.id,
      fdrNumber: "RB-001",
      lifecycleStatus: "ACTIVE",
    });
    const instrumentCount = await prisma.instrument.count();
    const historyCount = await prisma.instrumentHistory.count();
    const auditCount = await prisma.auditEvent.count();

    failAction.value = "instrument.replacement_created";
    await expect(
      replaceInstrument(asSession(admin), predecessor.id, {
        bankName: "Demo Cooperative Bank",
        fdrNumber: "RB-001-NEW",
        amount: "1500000",
        issueDate: "2036-02-01",
        maturityDate: "2041-02-01",
        holderName: "Sunrise Institute of Technology",
        declaredLienStatus: "UNKNOWN",
        reason: "Renewed at maturity for a fresh term under the same sanction.",
      }),
    ).rejects.toThrow("forced failure");
    failAction.value = null;

    const refreshed = await prisma.instrument.findUniqueOrThrow({ where: { id: predecessor.id } });
    expect(refreshed.lifecycleStatus).toBe("ACTIVE");
    expect(refreshed.replacedAt).toBeNull();
    expect(refreshed.replacedById).toBeNull();
    expect(refreshed.versionNo).toBe(1);

    expect(await prisma.instrument.count()).toBe(instrumentCount);
    expect(await prisma.instrument.count({ where: { fdrNumber: "RB-001-NEW" } })).toBe(0);
    expect(await prisma.instrumentHistory.count()).toBe(historyCount);
    expect(await prisma.auditEvent.count()).toBe(auditCount);
  });

  it("the rollback leaves the record immediately replaceable again", async () => {
    const predecessor = await prisma.instrument.findFirstOrThrow({
      where: { fdrNumber: "RB-001" },
    });
    const successor = await replaceInstrument(asSession(admin), predecessor.id, {
      bankName: "Demo Cooperative Bank",
      fdrNumber: "RB-001-NEW",
      amount: "1500000",
      issueDate: "2036-02-01",
      maturityDate: "2041-02-01",
      holderName: "Sunrise Institute of Technology",
      declaredLienStatus: "UNKNOWN",
      reason: "Renewed at maturity for a fresh term under the same sanction.",
    });
    expect(successor.replacesId).toBe(predecessor.id);
    const refreshed = await prisma.instrument.findUniqueOrThrow({
      where: { id: predecessor.id },
    });
    expect(refreshed.lifecycleStatus).toBe("REPLACED");
  });
});
