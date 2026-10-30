import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { roleOf, type Role } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth";

export const TEST_PASSWORD = "Demo@1234";

export async function resetAll() {
  await prisma.auditEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.clearanceNoc.deleteMany();
  await prisma.reviewTask.deleteMany();
  await prisma.releaseCase.deleteMany();
  await prisma.maturityAlert.deleteMany();
  await prisma.verificationAttempt.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.extractedField.deleteMany();
  await prisma.extractionRun.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.holderEndorsement.deleteMany();
  await prisma.instrumentHistory.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.programme.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.institution.deleteMany();
  await prisma.ruleVersion.deleteMany();
  await prisma.ruleSet.deleteMany();
  await prisma.demoState.deleteMany();
}

export async function makeInstitution(name: string, aicteRef: string) {
  return prisma.institution.create({
    data: { name, aicteRef, category: "Private unaided", state: "Maharashtra" },
  });
}

export async function makeUser(
  role: Role,
  email: string,
  institutionId: string | null = null,
  name = "Test User",
) {
  return prisma.user.create({
    data: {
      email,
      name,
      role,
      institutionId,
      passwordHash: hashPassword(TEST_PASSWORD),
    },
  });
}

export function asSession(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  institutionId: string | null;
  institution?: { name: string } | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: roleOf(user.role),
    institutionId: user.institutionId,
    institutionName: user.institution?.name ?? null,
  };
}

export async function makeInstrument(input: {
  institutionId: string;
  createdBy: string;
  fdrNumber?: string;
  bankName?: string;
  amount?: number;
  issueDate?: Date;
  maturityDate?: Date;
  lifecycleStatus?: string;
  documentStatus?: string;
  verificationStatus?: string;
  complianceStatus?: string;
  holderName?: string;
}) {
  const issueDate = input.issueDate ?? new Date(Date.UTC(2025, 0, 1));
  const maturityDate = input.maturityDate ?? new Date(Date.UTC(2035, 0, 1));
  return prisma.instrument.create({
    data: {
      institutionId: input.institutionId,
      bankName: input.bankName ?? "Demo Cooperative Bank",
      normalizedBank: (input.bankName ?? "Demo Cooperative Bank").toLowerCase().replace(/[^a-z0-9]/g, ""),
      fdrNumber: input.fdrNumber ?? `TEST-FDR-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      normalizedFdr: (input.fdrNumber ?? `TEST-FDR-${Date.now()}`)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ""),
      branch: null,
      amount: input.amount ?? 1_000_000,
      issueDate,
      maturityDate,
      holderName: input.holderName ?? "Sunrise Institute of Technology",
      declaredLienStatus: "UNKNOWN",
      lifecycleStatus: input.lifecycleStatus ?? "DRAFT",
      documentStatus: input.documentStatus ?? "NONE",
      verificationStatus: input.verificationStatus ?? "NOT_CHECKED",
      complianceStatus: input.complianceStatus ?? "NOT_EVALUATED",
      createdBy: input.createdBy,
      versionNo: 1,
    },
  });
}

export async function makeConfirmedDocument(instrumentId: string, uploadedBy: string) {
  const document = await prisma.documentVersion.create({
    data: {
      instrumentId,
      versionNo: 1,
      originalName: "synthetic.pdf",
      storageKey: `test-${instrumentId}.pdf`,
      sha256: "a".repeat(64),
      mime: "application/pdf",
      size: 128,
      uploadedBy,
      docStatus: "CONFIRMED",
    },
  });
  const run = await prisma.extractionRun.create({
    data: {
      documentId: document.id,
      adapter: "MOCK_OCR_V1",
      status: "EXTRACTED",
      simulated: true,
      finishedAt: new Date(),
    },
  });
  return { document, run };
}

export async function auditEventsAscending() {
  return prisma.auditEvent.findMany({ orderBy: { chainIndex: "asc" } });
}
