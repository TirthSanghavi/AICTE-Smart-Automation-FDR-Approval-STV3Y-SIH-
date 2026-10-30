import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { addDays, formatDate, todayInIST, toIsoDate } from "../src/lib/dates";
import { hashPassword } from "../src/lib/password";
import { syntheticFdrDocument, buildSyntheticPdf } from "../src/lib/demo-fixtures";
import { appendAudit } from "../src/lib/audit";
import { checklistFor, CHECKLIST_LABEL, CHECKLIST_VERSION } from "../src/lib/rules/checklist";
import { RULE_SEEDS } from "../src/lib/rules/rule-register";
import { DEMO_PASSWORD, ROLE } from "../src/lib/constants";
import { saveBytes } from "../src/lib/storage";

const prisma = new PrismaClient();
const today = todayInIST();
const passwordHash = hashPassword(DEMO_PASSWORD);

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  console.log("Resetting synthetic demo data…");
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
  await prisma.instrumentHistory.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.programme.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.institution.deleteMany();
  await prisma.ruleVersion.deleteMany();
  await prisma.ruleSet.deleteMany();
  await prisma.demoState.deleteMany();

  const uploadRoot = path.resolve(process.cwd(), process.env.FILE_STORE_PATH ?? ".data/uploads");
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true });

  const sunrise = await prisma.institution.create({
    data: {
      aicteRef: "SYN-INST-001",
      name: "Sunrise Institute of Technology",
      category: "Private unaided",
      state: "Maharashtra",
      city: "Pune",
      programmes: {
        create: [
          { name: "Computer Science & Engineering", level: "UG", intake: 180 },
          { name: "Mechanical Engineering", level: "UG", intake: 120 },
          { name: "Management Studies", level: "PG", intake: 60 },
        ],
      },
    },
    include: { programmes: true },
  });

  const lakeview = await prisma.institution.create({
    data: {
      aicteRef: "SYN-INST-002",
      name: "Lakeview Polytechnic",
      category: "Private unaided",
      state: "Karnataka",
      city: "Mysuru",
      programmes: {
        create: [{ name: "Diploma in Civil Engineering", level: "Diploma", intake: 90 }],
      },
    },
  });

  const [adminSunrise, , adminLakeview, officer, reviewer, authority] =
    await Promise.all([
      prisma.user.create({
        data: {
          email: "admin@sunrise.demo",
          name: "Meera Kulkarni",
          role: ROLE.INSTITUTION_ADMIN,
          institutionId: sunrise.id,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "viewer@sunrise.demo",
          name: "Rohan Deshmukh",
          role: ROLE.INSTITUTION_VIEWER,
          institutionId: sunrise.id,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "admin@lakeview.demo",
          name: "Ananya Rao",
          role: ROLE.INSTITUTION_ADMIN,
          institutionId: lakeview.id,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "officer@aicte.demo",
          name: "Ishaan Verma",
          role: ROLE.SCRUTINY_OFFICER,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "reviewer@aicte.demo",
          name: "Priya Nair",
          role: ROLE.DEPT_REVIEWER,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "authority@aicte.demo",
          name: "Dr. Arvind Menon",
          role: ROLE.COMPETENT_AUTHORITY,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "auditor@aicte.demo",
          name: "Sana Qureshi",
          role: ROLE.AUDITOR,
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          email: "sysadmin@aicte.demo",
          name: "Dev Sharma",
          role: ROLE.SYSTEM_ADMIN,
          passwordHash,
        },
      }),
    ]);

  for (const rule of RULE_SEEDS) {
    await prisma.ruleSet.create({
      data: {
        code: rule.code,
        title: rule.title,
        description: rule.description,
        versions: {
          create: {
            version: 1,
            status: rule.status,
            sourceRef: "SRC-003",
            sourceTitle: rule.sourceTitle,
            clause: rule.clause,
            page: rule.page,
            interpretation: rule.interpretation,
            applicability: rule.applicability,
          },
        },
      },
    });
  }

  type SeedInstrument = {
    key: string;
    institutionId: string;
    bankName: string;
    branch: string | null;
    fdrNumber: string;
    amount: number;
    issueDate: Date;
    maturityDate: Date;
    holderName: string;
    lien: string;
    lifecycle: string;
    verification: string;
    compliance: string;
    documentStatus: string;
    docName: string | null;
    docStatus: string | null;
    runStatus: string | null;
    confirmed: boolean;
    mismatch?: boolean;
    ocrFail?: boolean;
    findings?: {
      ruleId: string;
      field: string | null;
      observed: string;
      expected: string;
      basis: string;
      severity: string;
      explanation: string;
      action: string;
      resolution: string;
    }[];
    verificationAttempt?: {
      method: string;
      status: string;
      lienStatus: string;
      sourceName: string;
      reference: string;
      simulated: boolean;
      notes: string;
      limitations: string;
    };
  };

  const seeds: SeedInstrument[] = [
    {
      key: "active-primary",
      institutionId: sunrise.id,
      bankName: "Demo Cooperative Bank",
      branch: "Pune Camp",
      fdrNumber: "SYN-FDR-100241",
      amount: 3_500_000,
      issueDate: addDays(today, -420),
      maturityDate: addDays(today, 2_050),
      holderName: "Sunrise Institute of Technology",
      lien: "YES",
      lifecycle: "ACTIVE",
      verification: "SIMULATED_RESULT",
      compliance: "RULES_PENDING",
      documentStatus: "CONFIRMED",
      docName: "sunrise-primary-fdr.pdf",
      docStatus: "CONFIRMED",
      runStatus: "EXTRACTED",
      confirmed: true,
      verificationAttempt: {
        method: "SIMULATED",
        status: "SIMULATED_RESULT",
        lienStatus: "LIEN_CONFIRMED",
        sourceName: "Prototype bank simulator (not a bank)",
        reference: "SIM-SEED-0001",
        simulated: true,
        notes: "Synthetic simulator response. Not a bank confirmation.",
        limitations:
          "Synthetic simulator output. Not a bank confirmation, lien confirmation or proof of funds.",
      },
    },
    {
      key: "maturing-25",
      institutionId: sunrise.id,
      bankName: "Demo State Bank",
      branch: "Kothrud",
      fdrNumber: "SYN-FDR-100242",
      amount: 2_000_000,
      issueDate: addDays(today, -3_600),
      maturityDate: addDays(today, 25),
      holderName: "Sunrise Institute of Technology",
      lien: "YES",
      lifecycle: "ACTIVE",
      verification: "MANUAL_REVIEW_RECORDED",
      compliance: "RULES_PENDING",
      documentStatus: "CONFIRMED",
      docName: "sunrise-maturing-25.pdf",
      docStatus: "CONFIRMED",
      runStatus: "EXTRACTED",
      confirmed: true,
      verificationAttempt: {
        method: "MANUAL_CONFIRMATION",
        status: "MANUAL_REVIEW_RECORDED",
        lienStatus: "UNKNOWN",
        sourceName: "Bank email copy recorded by scrutiny desk",
        reference: "MAN-SEED-0002",
        simulated: false,
        notes: "Officer compared the bank email with the uploaded FDR.",
        limitations:
          "Recorded by a reviewer from the stated source. Not independently confirmed with the bank.",
      },
    },
    {
      key: "overdue-10",
      institutionId: sunrise.id,
      bankName: "Demo Urban Bank",
      branch: "Deccan",
      fdrNumber: "SYN-FDR-100243",
      amount: 1_250_000,
      issueDate: addDays(today, -3_670),
      maturityDate: addDays(today, -10),
      holderName: "Sunrise Institute of Technology",
      lien: "YES",
      lifecycle: "ACTIVE",
      verification: "SIMULATED_RESULT",
      compliance: "RULES_PENDING",
      documentStatus: "CONFIRMED",
      docName: "sunrise-overdue-10.pdf",
      docStatus: "CONFIRMED",
      runStatus: "EXTRACTED",
      confirmed: true,
      verificationAttempt: {
        method: "SIMULATED",
        status: "SIMULATED_RESULT",
        lienStatus: "LIEN_CONFIRMED",
        sourceName: "Prototype bank simulator (not a bank)",
        reference: "SIM-SEED-0003",
        simulated: true,
        notes: "Synthetic simulator response.",
        limitations: "Synthetic simulator output. Not a bank confirmation.",
      },
    },
    {
      key: "correction-requested",
      institutionId: sunrise.id,
      bankName: "Demo Cooperative Bank",
      branch: "Pune Camp",
      fdrNumber: "SYN-FDR-100244",
      amount: 900_000,
      issueDate: addDays(today, -120),
      maturityDate: addDays(today, -122),
      holderName: "Sunrise Institute of Technology",
      lien: "UNKNOWN",
      lifecycle: "CORRECTION_REQUESTED",
      verification: "NOT_CHECKED",
      compliance: "FINDINGS_OPEN",
      documentStatus: "CONFIRMED",
      docName: "sunrise-correction.pdf",
      docStatus: "CONFIRMED",
      runStatus: "EXTRACTED",
      confirmed: true,
      findings: [
        {
          ruleId: "DR-03",
          field: "maturityDate",
          observed: formatDate(addDays(today, -122)),
          expected: `A maturity date after ${formatDate(addDays(today, -120))}`,
          basis: "Date ordering check",
          severity: "CRITICAL",
          explanation:
            "Maturity date is earlier than the issue date on the submitted record.",
          action: "Correct the dates from the document or upload a clearer copy.",
          resolution: "CORRECTION_REQUESTED",
        },
        {
          ruleId: "DR-04",
          field: "maturityDate",
          observed: formatDate(addDays(today, -122)),
          expected: "Maturity on or after submission",
          basis: "Date-derived check at submission",
          severity: "HIGH",
          explanation: "The recorded maturity date has already passed.",
          action: "Confirm whether this FDR was renewed or released.",
          resolution: "CORRECTION_REQUESTED",
        },
      ],
    },
    {
      key: "submitted-mismatch",
      institutionId: sunrise.id,
      bankName: "Demo State Bank",
      branch: "Hadapsar",
      fdrNumber: "SYN-FDR-100245",
      amount: 1_500_000,
      issueDate: addDays(today, -300),
      maturityDate: addDays(today, 3_200),
      holderName: "Sunrise Institute of Technology",
      lien: "YES",
      lifecycle: "SUBMITTED",
      verification: "NOT_CHECKED",
      compliance: "RULES_PENDING",
      documentStatus: "CONFIRMED",
      docName: "demo-fdr-mismatch.pdf",
      docStatus: "CONFIRMED",
      runStatus: "EXTRACTED",
      confirmed: true,
      mismatch: true,
      findings: [
        {
          ruleId: "DR-07",
          field: "amount",
          observed: "Extracted: 1450000.00",
          expected: "Confirmed: 1500000.00",
          basis: "Extraction vs institution-confirmed value",
          severity: "INFO",
          explanation:
            "The confirmed amount differs from the mock extraction. Both values are preserved.",
          action: "A reviewer may ask for the source document.",
          resolution: "OPEN",
        },
        {
          ruleId: "DR-10",
          field: "maturityDate",
          observed: "Low confidence (57%)",
          expected: "Human confirmation",
          basis: "Mock extraction confidence threshold (0.70)",
          severity: "INFO",
          explanation:
            "Extraction confidence for maturity date is low. Confidence is not an authenticity score.",
          action: "Confirm against the document.",
          resolution: "OPEN",
        },
      ],
    },
    {
      key: "ocr-failed",
      institutionId: sunrise.id,
      bankName: "Demo Urban Bank",
      branch: "Karve Road",
      fdrNumber: "SYN-FDR-100246",
      amount: 750_000,
      issueDate: addDays(today, -500),
      maturityDate: addDays(today, 2_900),
      holderName: "Sunrise Institute of Technology",
      lien: "UNKNOWN",
      lifecycle: "DRAFT",
      verification: "NOT_CHECKED",
      compliance: "NOT_EVALUATED",
      documentStatus: "EXTRACTION_FAILED",
      docName: "demo-ocrfail-document.pdf",
      docStatus: "EXTRACTION_FAILED",
      runStatus: "EXTRACTION_FAILED",
      confirmed: false,
      ocrFail: true,
    },
    {
      key: "draft-new",
      institutionId: sunrise.id,
      bankName: "Demo Cooperative Bank",
      branch: null,
      fdrNumber: "SYN-FDR-100247",
      amount: 500_000,
      issueDate: addDays(today, -30),
      maturityDate: addDays(today, 3_600),
      holderName: "Sunrise Institute of Technology",
      lien: "UNKNOWN",
      lifecycle: "DRAFT",
      verification: "NOT_CHECKED",
      compliance: "NOT_EVALUATED",
      documentStatus: "NONE",
      docName: null,
      docStatus: null,
      runStatus: null,
      confirmed: false,
    },
    {
      key: "lakeview-active",
      institutionId: lakeview.id,
      bankName: "Demo Cooperative Bank",
      branch: "Mysuru",
      fdrNumber: "SYN-FDR-100241",
      amount: 1_000_000,
      issueDate: addDays(today, -240),
      maturityDate: addDays(today, 3_400),
      holderName: "Lakeview Polytechnic",
      lien: "YES",
      lifecycle: "ACTIVE",
      verification: "SIMULATED_RESULT",
      compliance: "RULES_PENDING",
      documentStatus: "CONFIRMED",
      docName: "lakeview-active.pdf",
      docStatus: "CONFIRMED",
      runStatus: "EXTRACTED",
      confirmed: true,
    },
  ];

  const instruments: Record<string, { id: string; institutionId: string }> = {};

  for (const seed of seeds) {
    const instrument = await prisma.instrument.create({
      data: {
        institutionId: seed.institutionId,
        bankName: seed.bankName,
        normalizedBank: seed.bankName.toLowerCase().replace(/[^a-z0-9]/g, ""),
        branch: seed.branch,
        fdrNumber: seed.fdrNumber,
        normalizedFdr: seed.fdrNumber.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        amount: seed.amount,
        issueDate: seed.issueDate,
        maturityDate: seed.maturityDate,
        holderName: seed.holderName,
        declaredLienStatus: seed.lien,
        lifecycleStatus: seed.lifecycle,
        documentStatus: seed.documentStatus,
        verificationStatus: seed.verification,
        complianceStatus: seed.compliance,
        createdBy:
          seed.institutionId === sunrise.id ? adminSunrise.id : adminLakeview.id,
        versionNo: seed.lifecycle === "DRAFT" ? 1 : 3,
      },
    });
    instruments[seed.key] = instrument;

    await prisma.instrumentHistory.create({
      data: {
        instrumentId: instrument.id,
        versionNo: 1,
        snapshot: JSON.stringify({
          event: "Seeded synthetic record",
          fdrNumber: seed.fdrNumber,
          lifecycleStatus: seed.lifecycle,
        }),
        changedBy: adminSunrise.id,
        reason: "Synthetic demo fixture",
      },
    });

    if (seed.docName) {
      const bytes = seed.docName.includes("ocrfail")
        ? buildSyntheticPdf([
            "SYNTHETIC DEMONSTRATION DOCUMENT",
            "NOT A REAL BANK INSTRUMENT",
            "",
            "This fixture is deliberately unreadable for the mock extractor:",
            "the filename contains \"ocrfail\" so extraction fails and the",
            "reviewer falls back to manual entry.",
            "",
            "The bytes are still a valid PDF so the preview renders honestly.",
            "Generated for the AICTE FDR portal prototype. No legal effect.",
          ])
        : syntheticFdrDocument({
            institution: seed.institutionId === sunrise.id ? sunrise.name : lakeview.name,
            bank: seed.bankName,
            fdrNumber: seed.fdrNumber,
            amount: seed.amount.toLocaleString("en-IN"),
            issueDate: toIsoDate(seed.issueDate),
            maturityDate: toIsoDate(seed.maturityDate),
            holder: seed.holderName,
          });
      const key = `seed-${seed.key}.${seed.docName.endsWith(".pdf") ? "pdf" : "jpg"}`;
      await saveBytes(key, bytes);
      const document = await prisma.documentVersion.create({
        data: {
          instrumentId: instrument.id,
          versionNo: 1,
          originalName: seed.docName,
          storageKey: key,
          sha256: sha256(bytes),
          mime: seed.docName.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
          size: bytes.length,
          uploadedBy:
            seed.institutionId === sunrise.id ? adminSunrise.id : adminLakeview.id,
          docStatus: seed.docStatus ?? "UPLOADED",
        },
      });

      if (seed.runStatus) {
        const run = await prisma.extractionRun.create({
          data: {
            documentId: document.id,
            adapter: seed.runStatus === "EXTRACTION_FAILED" ? "MOCK_OCR_V1" : "MOCK_OCR_V1",
            status: seed.runStatus,
            simulated: true,
            finishedAt: new Date(),
            error:
              seed.runStatus === "EXTRACTION_FAILED"
                ? "The mock extractor could not read this file. Enter the fields manually."
                : null,
          },
        });

        if (seed.runStatus === "EXTRACTED") {
          const amount = seed.mismatch ? seed.amount - 50_000 : seed.amount;
          const maturity = seed.mismatch
            ? addDays(seed.maturityDate, -3)
            : seed.maturityDate;
          const fieldData: [string, string, string, number][] = [
            ["bankName", seed.bankName, seed.bankName, 0.94],
            ["branch", seed.branch ?? "", seed.branch ?? "", 0.72],
            ["fdrNumber", seed.fdrNumber, seed.fdrNumber, 0.96],
            ["amount", amount.toFixed(2), seed.amount.toFixed(2), seed.mismatch ? 0.61 : 0.89],
            [
              "issueDate",
              toIsoDate(seed.issueDate),
              toIsoDate(seed.issueDate),
              0.93,
            ],
            [
              "maturityDate",
              toIsoDate(maturity),
              toIsoDate(seed.maturityDate),
              seed.mismatch ? 0.57 : 0.84,
            ],
            ["holderName", seed.holderName, seed.holderName, 0.9],
            ["declaredLienStatus", seed.lien, seed.lien, 0.55],
          ];
          await prisma.extractedField.createMany({
            data: fieldData.map(([name, value, confirmed, confidence]) => ({
              runId: run.id,
              instrumentId: instrument.id,
              name,
              value,
              confidence,
              confirmedValue: seed.confirmed ? confirmed : null,
              provenance:
                seed.confirmed && value !== confirmed ? "USER" : "OCR",
              confirmedBy: seed.confirmed
                ? seed.institutionId === sunrise.id
                  ? adminSunrise.id
                  : adminLakeview.id
                : null,
              confirmedAt: seed.confirmed ? new Date() : null,
            })),
          });
        }
      }
    }

    if (seed.findings) {
      for (const finding of seed.findings) {
        await prisma.finding.create({
          data: {
            instrumentId: instrument.id,
            ruleId: finding.ruleId,
            field: finding.field,
            observed: finding.observed,
            expected: finding.expected,
            basis: finding.basis,
            severity: finding.severity,
            explanation: finding.explanation,
            recommendedAction: finding.action,
            resolutionStatus: finding.resolution,
            correctionDueDate:
              finding.resolution === "CORRECTION_REQUESTED"
                ? addDays(today, 7)
                : null,
          },
        });
      }
    }

    if (seed.verificationAttempt) {
      await prisma.verificationAttempt.create({
        data: {
          instrumentId: instrument.id,
          method: seed.verificationAttempt.method,
          status: seed.verificationAttempt.status,
          lienStatus: seed.verificationAttempt.lienStatus,
          sourceName: seed.verificationAttempt.sourceName,
          reference: seed.verificationAttempt.reference,
          asOf: addDays(today, -2),
          simulated: seed.verificationAttempt.simulated,
          byUser: officer.id,
          notes: seed.verificationAttempt.notes,
          limitations: seed.verificationAttempt.limitations,
        },
      });
    }
  }

  // Case A — open, partly reviewed release case on the primary instrument.
  const primary = instruments["active-primary"];
  const openCase = await prisma.releaseCase.create({
    data: {
      instrumentId: primary.id,
      institutionId: sunrise.id,
      type: "RELEASE",
      reason:
        "Institution requests release after completing the deposit term, subject to authorized review.",
      status: "IN_REVIEW",
      templateVersion: CHECKLIST_VERSION,
      templateLabel: CHECKLIST_LABEL,
      createdBy: adminSunrise.id,
      tasks: {
        create: checklistFor("RELEASE").map((task) => ({
          stepOrder: task.stepOrder,
          role: task.role,
          title: task.title,
          description: task.description,
          required: task.required,
          status: task.stepOrder <= 2 ? "COMPLETED" : "PENDING",
          outcome: task.stepOrder <= 2 ? "SATISFIED" : null,
          notes:
            task.stepOrder === 1
              ? "Synthetic request letter and Affidavit 6 attached to the demo case."
              : task.stepOrder === 2
                ? "Latest FDR and synthetic LoA compared to the submitted values."
                : null,
          completedBy:
            task.stepOrder === 1
              ? adminSunrise.id
              : task.stepOrder === 2
                ? officer.id
                : null,
          completedAt: task.stepOrder <= 2 ? addDays(today, -3) : null,
        })),
      },
    },
  });

  // Case B — fully reviewed and approved, instrument deliberately still ACTIVE.
  const overdue = instruments["overdue-10"];
  const approvedCase = await prisma.releaseCase.create({
    data: {
      instrumentId: overdue.id,
      institutionId: sunrise.id,
      type: "REFUND",
      reason:
        "Synthetic matured-deposit refund case used to demonstrate an authorized decision.",
      status: "APPROVED",
      templateVersion: CHECKLIST_VERSION,
      templateLabel: CHECKLIST_LABEL,
      createdBy: adminSunrise.id,
      tasks: {
        create: checklistFor("REFUND").map((task) => ({
          stepOrder: task.stepOrder,
          role: task.role,
          title: task.title,
          description: task.description,
          required: task.required,
          status: "COMPLETED",
          outcome: "SATISFIED",
          notes: "Synthetic evidence reviewed for the demo.",
          completedBy:
            task.role === ROLE.INSTITUTION_ADMIN
              ? adminSunrise.id
              : task.role === ROLE.DEPT_REVIEWER
                ? reviewer.id
                : officer.id,
          completedAt: addDays(today, -6),
        })),
      },
    },
    include: { tasks: true },
  });

  await prisma.clearanceNoc.createMany({
    data: [
      {
        caseId: approvedCase.id,
        kind: "PGRC",
        issuer: "Synthetic PGRC cell",
        reference: "SYN-PGRC-2026-014",
        issuedOn: addDays(today, -20),
        scope: "Synthetic clearance for demo only",
        verifiedBy: reviewer.id,
        verifiedAt: addDays(today, -8),
      },
      {
        caseId: approvedCase.id,
        kind: "VIGILANCE",
        issuer: "Synthetic Vigilance cell",
        reference: "SYN-VIG-2026-009",
        issuedOn: addDays(today, -18),
        scope: "Synthetic NOC for demo only",
        verifiedBy: reviewer.id,
        verifiedAt: addDays(today, -8),
      },
    ],
  });

  await prisma.decision.create({
    data: {
      caseId: approvedCase.id,
      outcome: "APPROVED",
      reason:
        "Synthetic demo decision: checklist satisfied and evidence recorded. This does not instruct a bank or move funds.",
      authorityUserId: authority.id,
      checklistSnapshot: JSON.stringify(
        approvedCase.tasks.map((task) => ({
          title: task.title,
          role: task.role,
          required: task.required,
          status: task.status,
          outcome: task.outcome,
          completedBy: task.completedBy,
        })),
      ),
      decidedAt: addDays(today, -5),
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: adminSunrise.id,
        type: "CORRECTION_REQUESTED",
        title: "Correction requested on SYN-FDR-100244",
        body: "Maturity date is earlier than the issue date. Upload a corrected document version.",
        dedupeKey: "seed-notification-correction",
        status: "UNREAD",
      },
      {
        userId: adminSunrise.id,
        type: "CASE_DECIDED",
        title: "Refund case approved",
        body: "The synthetic refund case for SYN-FDR-100243 was approved. This is not a bank instruction.",
        dedupeKey: "seed-notification-decision",
        status: "UNREAD",
      },
      {
        userId: officer.id,
        type: "INSTRUMENT_SUBMITTED",
        title: "Instrument awaiting scrutiny",
        body: "Sunrise Institute of Technology submitted SYN-FDR-100245.",
        dedupeKey: "seed-notification-submitted",
        status: "UNREAD",
      },
    ],
  });

  await prisma.demoState.create({ data: { id: "singleton", demoDate: null } });

  // A short, coherent audit history so the trail is demonstrable immediately.
  const auditEvents: {
    actorId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    reason?: string;
  }[] = [
    {
      actorId: adminSunrise.id,
      actorRole: ROLE.INSTITUTION_ADMIN,
      action: "demo.seeded",
      entityType: "demo",
      entityId: "synthetic-pack-v1",
      reason: "Synthetic demo pack; no real institution, person or bank data.",
    },
    {
      actorId: adminSunrise.id,
      actorRole: ROLE.INSTITUTION_ADMIN,
      action: "instrument.created",
      entityType: "instrument",
      entityId: primary.id,
      reason: "Seeded synthetic FDR",
    },
    {
      actorId: officer.id,
      actorRole: ROLE.SCRUTINY_OFFICER,
      action: "verification.recorded",
      entityType: "verification_attempt",
      entityId: instruments["active-primary"].id,
      reason: "Simulated result only; not a bank confirmation.",
    },
    {
      actorId: adminSunrise.id,
      actorRole: ROLE.INSTITUTION_ADMIN,
      action: "case.opened",
      entityType: "release_case",
      entityId: openCase.id,
      reason: "Synthetic release request",
    },
    {
      actorId: reviewer.id,
      actorRole: ROLE.DEPT_REVIEWER,
      action: "task.completed",
      entityType: "review_task",
      entityId: approvedCase.tasks[2]?.id ?? approvedCase.id,
      reason: "Synthetic clearance reviewed",
    },
    {
      actorId: authority.id,
      actorRole: ROLE.COMPETENT_AUTHORITY,
      action: "decision.recorded",
      entityType: "decision",
      entityId: approvedCase.id,
      reason: "Synthetic approval; no funds moved.",
    },
  ];

  await prisma.$transaction(async (tx) => {
    for (const event of auditEvents) {
      await appendAudit(tx, {
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        reason: event.reason,
      });
    }
  });

  console.log("Seed complete.");
  console.log(`Institutions: ${sunrise.name} / ${lakeview.name}`);
  console.log(`Demo password for every account: ${DEMO_PASSWORD}`);
  console.log("Accounts: admin@sunrise.demo, viewer@sunrise.demo, admin@lakeview.demo,");
  console.log("          officer@aicte.demo, reviewer@aicte.demo, authority@aicte.demo,");
  console.log("          auditor@aicte.demo, sysadmin@aicte.demo");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
