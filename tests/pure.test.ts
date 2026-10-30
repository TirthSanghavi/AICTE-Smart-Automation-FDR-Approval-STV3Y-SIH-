import { describe, expect, it } from "vitest";
import {
  dateOnly,
  daysBetween,
  deriveMaturity,
  parseIsoDate,
  todayInIST,
  toIsoDate,
} from "@/lib/dates";
import { detectFileType, validateUpload, MAX_UPLOAD_BYTES } from "@/lib/documents";
import { AppError } from "@/lib/errors";
import {
  evaluateDiscrepancies,
  holderSimilarity,
} from "@/lib/rules/discrepancy";
import { checklistSatisfied } from "@/lib/rules/checklist";
import { hashPassword, verifyPassword } from "@/lib/password";

function pdfBytes(label = "test"): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${label}\n%%EOF\n`);
}

const baseInstrument = {
  id: "inst-test",
  bankName: "Demo Cooperative Bank",
  fdrNumber: "FDR-001",
  amount: 1_000_000,
  issueDate: dateOnly(2026, 1, 10),
  maturityDate: dateOnly(2036, 1, 10),
  holderName: "Sunrise Institute of Technology",
  declaredLienStatus: "UNKNOWN",
};

const baseInput = {
  instrument: baseInstrument,
  institutionName: "Sunrise Institute of Technology",
  today: dateOnly(2026, 10, 26),
  duplicates: [],
  extractionDiffs: [],
  lowConfidence: [],
  conflictingVerification: null,
  labelForField: (field: string) => field,
};

describe("dates", () => {
  it("derives buckets from the injected day and never stores them", () => {
    const today = dateOnly(2026, 10, 26);
    expect(deriveMaturity(dateOnly(2026, 11, 25), today)).toMatchObject({
      bucket: "MATURING",
      days: 30,
    });
    expect(deriveMaturity(dateOnly(2027, 3, 1), today).bucket).toBe("UPCOMING");
    expect(deriveMaturity(dateOnly(2026, 10, 16), today)).toMatchObject({
      bucket: "MATURED",
      days: -10,
    });
    expect(deriveMaturity(dateOnly(2026, 10, 26), today).bucket).toBe("MATURING");
  });

  it("uses the IST calendar date across the UTC boundary", () => {
    expect(toIsoDate(todayInIST(new Date("2026-10-26T18:29:00Z")))).toBe("2026-10-26");
    expect(toIsoDate(todayInIST(new Date("2026-10-26T18:30:00Z")))).toBe("2026-10-27");
  });

  it("rejects impossible ISO dates and counts whole days", () => {
    expect(() => parseIsoDate("2026-02-30")).toThrow("INVALID_DATE");
    expect(() => parseIsoDate("26-10-2026")).toThrow("INVALID_DATE");
    expect(daysBetween(dateOnly(2026, 10, 26), dateOnly(2026, 11, 25))).toBe(30);
  });
});

describe("upload validation", () => {
  it("accepts a real PDF and detects its type", () => {
    const result = validateUpload({
      fileName: "fdr.pdf",
      declaredMime: "application/pdf",
      bytes: pdfBytes(),
    });
    expect(result).toEqual({ mime: "application/pdf", extension: "pdf" });
    expect(detectFileType(pdfBytes())?.extension).toBe("pdf");
  });

  it("rejects a .pdf filename with non-PDF bytes", () => {
    try {
      validateUpload({
        fileName: "fake.pdf",
        declaredMime: "application/pdf",
        bytes: Buffer.from("this is not a pdf"),
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FILE_CONTENT_TYPE_MISMATCH");
      expect((error as AppError).status).toBe(415);
    }
  });

  it("rejects declared/actual MIME mismatches and wrong extensions", () => {
    expect(() =>
      validateUpload({
        fileName: "fdr.pdf",
        declaredMime: "image/png",
        bytes: pdfBytes(),
      }),
    ).toThrow(AppError);
    expect(() =>
      validateUpload({
        fileName: "fdr.png",
        declaredMime: "application/pdf",
        bytes: pdfBytes(),
      }),
    ).toThrow(AppError);
  });

  it("rejects empty and oversized files", () => {
    expect(() =>
      validateUpload({ fileName: "empty.pdf", declaredMime: "application/pdf", bytes: Buffer.alloc(0) }),
    ).toThrow(AppError);

    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    oversized.write("%PDF-", 0, "latin1");
    try {
      validateUpload({ fileName: "big.pdf", declaredMime: "application/pdf", bytes: oversized });
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as AppError).status).toBe(413);
      expect((error as AppError).code).toBe("FILE_TOO_LARGE");
    }
  });

  it("accepts PNG and JPEG signatures", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
    expect(
      validateUpload({ fileName: "scan.png", declaredMime: "image/png", bytes: png }).extension,
    ).toBe("png");
    expect(
      validateUpload({ fileName: "scan.jpg", declaredMime: "image/jpeg", bytes: jpeg }).extension,
    ).toBe("jpg");
  });
});

describe("discrepancy engine", () => {
  it("flags maturity before issue as critical with explanation fields", () => {
    const findings = evaluateDiscrepancies({
      ...baseInput,
      instrument: {
        ...baseInstrument,
        issueDate: dateOnly(2026, 3, 16),
        maturityDate: dateOnly(2026, 3, 14),
      },
    });
    const dr03 = findings.find((finding) => finding.ruleId === "DR-03");
    expect(dr03).toBeTruthy();
    expect(dr03?.severity).toBe("CRITICAL");
    expect(dr03?.explanation).toContain("Maturity date");
    expect(dr03?.recommendedAction.length).toBeGreaterThan(10);
  });

  it("flags a passed maturity and a different holder", () => {
    const findings = evaluateDiscrepancies({
      ...baseInput,
      instrument: { ...baseInstrument, maturityDate: dateOnly(2026, 10, 1), holderName: "Other Education Society" },
    });
    expect(findings.some((finding) => finding.ruleId === "DR-04")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "DR-05")).toBe(true);
  });

  it("accepts the registered holder with a trailing trust suffix", () => {
    expect(
      holderSimilarity("Sunrise Institute of Technology Trust", "Sunrise Institute of Technology"),
    ).toBe(1);
    expect(holderSimilarity("Sunrise Education Society", "Sunrise Institute of Technology")).toBeLessThan(0.5);
  });

  it("routes duplicates to review instead of rejecting", () => {
    const findings = evaluateDiscrepancies({
      ...baseInput,
      duplicates: [
        {
          id: "other",
          fdrNumber: "FDR-001",
          bankName: "Demo Cooperative Bank",
          institutionName: "Lakeview Polytechnic",
        },
      ],
    });
    const duplicate = findings.find((finding) => finding.ruleId === "DR-06");
    expect(duplicate?.severity).toBe("CRITICAL");
    expect(duplicate?.explanation).toContain("Nothing has been overwritten");
  });

  it("records extraction differences and low confidence as information only", () => {
    const findings = evaluateDiscrepancies({
      ...baseInput,
      extractionDiffs: [{ field: "amount", extracted: "950000.00", confirmed: "1000000.00" }],
      lowConfidence: [{ field: "maturityDate", value: "2036-01-10", confidence: 0.57 }],
    });
    expect(findings.find((finding) => finding.ruleId === "DR-07")?.severity).toBe("INFO");
    expect(findings.find((finding) => finding.ruleId === "DR-10")?.severity).toBe("INFO");
  });

  it("treats an independent conflicting source as critical", () => {
    const findings = evaluateDiscrepancies({
      ...baseInput,
      conflictingVerification: { sourceName: "Bank email", status: "BANK_NOT_CONFIRMED" },
    });
    expect(findings.find((finding) => finding.ruleId === "DR-11")?.severity).toBe("CRITICAL");
  });
});

describe("checklist", () => {
  it("requires every required task to be COMPLETED and SATISFIED", () => {
    expect(
      checklistSatisfied([
        { required: true, status: "COMPLETED", outcome: "SATISFIED" },
        { required: false, status: "PENDING", outcome: null },
      ]).complete,
    ).toBe(true);
    expect(
      checklistSatisfied([
        { required: true, status: "COMPLETED", outcome: "SATISFIED" },
        { required: true, status: "COMPLETED", outcome: "NOT_SATISFIED" },
      ]).complete,
    ).toBe(false);
    expect(
      checklistSatisfied([{ required: true, status: "PENDING", outcome: null }]).complete,
    ).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the correct password and rejects a wrong one", () => {
    const stored = hashPassword("Demo@1234");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Demo@1234", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("Demo@1234", "not-a-hash")).toBe(false);
  });
});
