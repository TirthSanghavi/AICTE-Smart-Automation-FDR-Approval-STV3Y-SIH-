import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/constants";
import { addDays } from "@/lib/dates";
import { csvCell, csvLine } from "@/lib/csv";
import { reportCsvChunks, runReport } from "@/lib/services/reports";
import {
  asSession,
  makeInstrument,
  makeInstitution,
  makeUser,
  resetAll,
} from "./helpers";

let institutionA: { id: string; name: string };
let institutionB: { id: string; name: string };
let institutionC: { id: string; name: string };
let adminA: Awaited<ReturnType<typeof makeUser>>;
let adminB: Awaited<ReturnType<typeof makeUser>>;
let adminC: Awaited<ReturnType<typeof makeUser>>;
let officer: Awaited<ReturnType<typeof makeUser>>;

async function collect(reportId: string, user: ReturnType<typeof asSession>, filters = {}) {
  const chunks: string[] = [];
  for await (const chunk of reportCsvChunks(reportId, user, filters)) {
    chunks.push(chunk);
  }
  return chunks;
}

beforeAll(async () => {
  await resetAll();
  institutionA = await makeInstitution("Sunrise Institute of Technology", "SYN-REP-A");
  institutionB = await makeInstitution("Lakeview Polytechnic", "SYN-REP-B");
  institutionC = await makeInstitution("Ashoka College of Engineering", "SYN-REP-C");
  adminA = await makeUser(ROLE.INSTITUTION_ADMIN, "rep.admin.a@test.demo", institutionA.id);
  adminB = await makeUser(ROLE.INSTITUTION_ADMIN, "rep.admin.b@test.demo", institutionB.id);
  adminC = await makeUser(ROLE.INSTITUTION_ADMIN, "rep.admin.c@test.demo", institutionC.id);
  officer = await makeUser(ROLE.SCRUTINY_OFFICER, "rep.officer@test.demo");

  // Institution A: 1M + 2M ACTIVE (HDFC), 500k REPLACED, 300k CLOSED, 100 DRAFT,
  // plus one overdue ACTIVE (maturity in the past).
  await makeInstrument({ institutionId: institutionA.id, createdBy: adminA.id, fdrNumber: "A-1", bankName: "HDFC Bank", amount: 1_000_000, lifecycleStatus: "ACTIVE" });
  await makeInstrument({ institutionId: institutionA.id, createdBy: adminA.id, fdrNumber: "A-2", bankName: "HDFC Bank Ltd", amount: 2_000_000, lifecycleStatus: "ACTIVE" });
  await makeInstrument({ institutionId: institutionA.id, createdBy: adminA.id, fdrNumber: "A-3", bankName: "HDFC Bank", amount: 500_000, lifecycleStatus: "REPLACED" });
  await makeInstrument({ institutionId: institutionA.id, createdBy: adminA.id, fdrNumber: "A-4", bankName: "HDFC Bank", amount: 300_000, lifecycleStatus: "CLOSED" });
  await makeInstrument({ institutionId: institutionA.id, createdBy: adminA.id, fdrNumber: "A-5", bankName: "HDFC Bank", amount: 100, lifecycleStatus: "DRAFT" });
  await makeInstrument({ institutionId: institutionA.id, createdBy: adminA.id, fdrNumber: "A-6", bankName: "HDFC Bank", amount: 700_000, lifecycleStatus: "ACTIVE", maturityDate: addDays(new Date(), -30) });

  // Institution B: 400k ACTIVE (SBI), 250k SUBMITTED.
  await makeInstrument({ institutionId: institutionB.id, createdBy: adminB.id, fdrNumber: "B-1", bankName: "State Bank of Demo", amount: 400_000, lifecycleStatus: "ACTIVE" });
  await makeInstrument({ institutionId: institutionB.id, createdBy: adminB.id, fdrNumber: "B-2", bankName: "State Bank of Demo", amount: 250_000, lifecycleStatus: "SUBMITTED" });

  // One release case for the case-status report.
  const instrumentB1 = await prisma.instrument.findFirstOrThrow({ where: { fdrNumber: "B-1" } });
  await prisma.releaseCase.create({
    data: {
      instrumentId: instrumentB1.id,
      institutionId: institutionB.id,
      type: "RELEASE",
      reason: "Project completed; deposit released as per sanction.",
      templateVersion: "v1",
      templateLabel: "Illustrative checklist",
      createdBy: adminB.id,
      status: "OPEN",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("report totals", () => {
  it("computes institution-wise exposure without double-counting replaced or released rows", async () => {
    const report = await runReport("institution-exposure", asSession(officer), {});
    const rowA = report.rows.find((row) => row.aicteRef === "SYN-REP-A");
    const rowB = report.rows.find((row) => row.aicteRef === "SYN-REP-B");

    // A: active = 1,000,000 + 2,000,000 + 700,000 (overdue but still ACTIVE).
    expect(rowA?.activeRecords).toBe(3);
    expect(rowA?.activeExposure).toBe(3_700_000);
    // Ledger total includes replaced + closed + draft.
    expect(rowA?.allTimeRecorded).toBe(4_500_100);
    expect(rowA?.records).toBe(6);

    expect(rowB?.activeExposure).toBe(400_000);
    expect(rowB?.allTimeRecorded).toBe(650_000);

    // Replaced predecessor amount never inflates active exposure.
    expect(rowA?.activeExposure as number).toBeLessThan(rowA?.allTimeRecorded as number);

    expect(report.totals.records).toBe(8);
    expect(report.totals.activeExposure).toBe(4_100_000);
    expect(report.definition).toContain("never double-counted");
  });

  it("computes bank-wise exposure grouped on the normalized bank name", async () => {
    const report = await runReport("bank-exposure", asSession(officer), {});
    const hdfcRows = report.rows.filter((row) => String(row.bank).includes("HDFC"));
    const sbi = report.rows.find((row) => String(row.bank).includes("State Bank"));

    // "HDFC Bank" and "HDFC Bank Ltd" normalize differently → two groups.
    expect(hdfcRows.length).toBe(2);
    const hdfcActive = hdfcRows.reduce((sum, row) => sum + (row.activeExposure as number), 0);
    const hdfcAllTime = hdfcRows.reduce((sum, row) => sum + (row.allTimeRecorded as number), 0);
    expect(hdfcActive).toBe(3_700_000);
    expect(hdfcAllTime).toBe(4_500_100);
    expect(sbi?.activeExposure).toBe(400_000);
    expect(report.totals.activeExposure).toBe(4_100_000);
  });

  it("aggregates lifecycle status counts and derived maturity buckets", async () => {
    const report = await runReport("status-counts", asSession(officer), {});
    const byStatus = new Map(report.rows.map((row) => [row.status, row]));
    expect((byStatus.get("ACTIVE")?.records as number)).toBe(4);
    expect((byStatus.get("REPLACED")?.records as number)).toBe(1);
    expect((byStatus.get("CLOSED")?.records as number)).toBe(1);
    expect((byStatus.get("DRAFT")?.records as number)).toBe(1);
    expect((byStatus.get("SUBMITTED")?.records as number)).toBe(1);
    // Derived, never stored: one overdue ACTIVE (A-6) and none within 90 days.
    expect((byStatus.get("DERIVED_MATURED_NOT_RELEASED")?.records as number)).toBe(1);
    expect((byStatus.get("DERIVED_MATURING_90D")?.records as number)).toBe(0);
    // Active amount excludes replaced and released rows.
    expect(report.totals.activeAmount).toBe(4_100_000);
  });

  it("lists pending verification excluding replaced and released records", async () => {
    const report = await runReport("pending-verification", asSession(officer), {});
    const rowsA = report.rows.filter((row) => row.institution === institutionA.name);
    // A: 3 ACTIVE + 1 DRAFT are non-terminal and NOT_CHECKED; REPLACED/CLOSED excluded.
    expect(report.total).toBe(6); // rowsA(4) + B(2)
    expect(rowsA.length).toBeLessThanOrEqual(report.pageSize);
    expect(report.rows.some((row) => row.lifecycle === "REPLACED")).toBe(false);
    expect(report.rows.some((row) => row.lifecycle === "CLOSED")).toBe(false);
  });

  it("orders maturities with overdue buckets derived from the clock", async () => {
    const report = await runReport("maturities", asSession(officer), {});
    expect(report.rows[0]?.fdrNumber).toBe("A-6"); // overdue sorts first
    expect(report.rows[0]?.bucket).toBe("OVERDUE");
    expect(report.rows.some((row) => row.bucket === "UPCOMING")).toBe(true);
  });

  it("summarises release/refund cases by type and status", async () => {
    const report = await runReport("case-status", asSession(officer), {});
    expect(report.total).toBe(1);
    const open = report.rows.find((row) => row.status === "OPEN");
    expect(open?.fdrNumber).toBe("B-1");
    expect(open?.institution).toBe(institutionB.name);
  });
});

describe("report filters and scoping", () => {
  it("applies bank, status and maturity-range filters", async () => {
    const byBank = await runReport("bank-exposure", asSession(officer), { bank: "hdfc" });
    expect(byBank.rows.length).toBe(2);
    expect(byBank.rows.every((row) => String(row.bank).includes("HDFC"))).toBe(true);
    expect(byBank.rows.reduce((sum, row) => sum + (row.activeExposure as number), 0)).toBe(3_700_000);

    const byStatus = await runReport("status-counts", asSession(officer), { status: "REPLACED" });
    expect(byStatus.total).toBe(1);
    expect(byStatus.rows[0].status).toBe("REPLACED");

    const from = new Date();
    const fromIso = addDays(from, -365 * 10).toISOString().slice(0, 10);
    const toIso = addDays(from, -1).toISOString().slice(0, 10);
    const maturedRange = await runReport("maturities", asSession(officer), { from: fromIso, to: toIso });
    expect(maturedRange.rows.map((row) => row.fdrNumber)).toEqual(["A-6"]);
  });

  it("pins institution sessions to their own tenant even when another institution is requested", async () => {
    const bypass = await runReport("institution-exposure", asSession(adminA), {
      institutionId: institutionB.id,
    });
    expect(bypass.rows.length).toBe(1);
    expect(bypass.rows[0].aicteRef).toBe("SYN-REP-A");

    const ownRows = await runReport("pending-verification", asSession(adminA), {});
    expect(ownRows.rows.every((row) => row.institution === institutionA.name)).toBe(true);

    const foreign = await runReport("maturities", asSession(adminB), {
      institutionId: institutionA.id,
    });
    expect(foreign.rows.every((row) => row.institution !== institutionA.name)).toBe(true);
  });

  it("returns an empty, well-formed result for an institution with no records", async () => {
    const empty = await runReport("institution-exposure", asSession(adminC), {});
    // Scoped to C: no instrument rows → no groups.
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(0);

    const findings = await runReport("discrepancies", asSession(adminC), {});
    expect(findings.rows).toEqual([]);
    expect(findings.total).toBe(0);
  });
});

describe("CSV export", () => {
  it("escapes commas, quotes and line breaks per RFC 4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
    expect(csvLine(["a", "b,c", 'q"q'])).toBe('a,"b,c","q""q"\r\n');
  });

  it("neutralises spreadsheet formula injection", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+1+2")).toBe("'+1+2");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tTAB")).toBe("'\tTAB");
    // Formula combined with quotes and a comma gets both protections, in order.
    expect(csvCell('=CONCAT("a", A1)')).toBe('"\'=CONCAT(""a"", A1)"');
    expect(csvCell("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0");
  });

  it("emits a header line followed by one line per row, honouring filters", async () => {
    const bankChunks = await collect("bank-exposure", asSession(officer), { bank: "hdfc" });
    expect(bankChunks[0]).toContain("Bank");
    expect(bankChunks[0]).toContain("Active exposure");
    expect(bankChunks.length).toBe(3); // header + two HDFC groups
    expect(bankChunks.join("")).toContain("HDFC");
    expect(bankChunks.join("")).not.toContain("State Bank of Demo");

    // The institution report carries no bank column; the bank filter still
    // restricts the row set to institutions holding matching instruments.
    const instChunks = await collect("institution-exposure", asSession(officer), { bank: "hdfc" });
    expect(instChunks[1]).toContain("SYN-REP-A");
    expect(instChunks.join("")).not.toContain("SYN-REP-B");
  });

  it("exports an empty report as a header-only file", async () => {
    const chunks = await collect("discrepancies", asSession(adminC), {});
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("Rule");
  });

  it("streams a large result set in batches without loading it all at once", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => ({
      institutionId: institutionC.id,
      bankName: "Bulk Demo Bank",
      normalizedBank: "bulkdemonbank",
      fdrNumber: `BULK-${index}`,
      normalizedFdr: `BULK${index}`,
      amount: 1000,
      issueDate: new Date(Date.UTC(2026, 0, 1)),
      maturityDate: new Date(Date.UTC(2030, 0, 1)),
      holderName: "Ashoka College of Engineering",
      lifecycleStatus: "ACTIVE",
      createdBy: adminC.id,
      versionNo: 1,
    }));
    await prisma.instrument.createMany({ data: rows });

    const chunks = await collect("maturities", asSession(officer), {});
    const dataLines = chunks.slice(1);
    expect(dataLines.length).toBe(1201 + 4); // bulk + the 4 pre-existing ACTIVE rows
    // Batch size 500 → multiple streamed chunks beyond the header.
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0]).toContain("FDR number");
    // Streamed batches are id-ordered, so spot-check membership, not position.
    expect(chunks.join("")).toContain("BULK-0");
    expect(chunks.join("")).toContain("BULK-1200");

    const paged = await runReport("maturities", asSession(officer), {}, { page: 999, pageSize: 25 });
    expect(paged.rows).toEqual([]);
    expect(paged.total).toBeGreaterThan(1200);
  });
});
