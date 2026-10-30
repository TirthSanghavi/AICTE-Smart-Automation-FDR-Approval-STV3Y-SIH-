import { toIsoDate } from "../dates";

export type OcrFieldName =
  | "bankName"
  | "branch"
  | "fdrNumber"
  | "amount"
  | "issueDate"
  | "maturityDate"
  | "holderName"
  | "declaredLienStatus";

export type OcrField = {
  name: OcrFieldName;
  value: string;
  confidence: number;
};

export type OcrInput = {
  fileName: string;
  instrument: {
    bankName: string;
    branch: string | null;
    fdrNumber: string;
    amount: { toString(): string };
    issueDate: Date;
    maturityDate: Date;
    holderName: string;
    declaredLienStatus: string;
  };
};

export type OcrResult = {
  status: "EXTRACTED";
  adapter: string;
  simulated: true;
  fields: OcrField[];
};

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrUnavailableError";
  }
}

/**
 * Deterministic demo extractor. It intentionally does not read the uploaded
 * bytes; it echoes the submitted record with synthetic confidence values so the
 * review/provenance flow can be demonstrated. A filename containing "mismatch"
 * produces a deliberate amount/date discrepancy; "ocrfail" simulates failure.
 */
export class MockOcrAdapter {
  readonly adapter = "MOCK_OCR_V1";

  async extract(input: OcrInput): Promise<OcrResult> {
    const fileName = input.fileName.toLowerCase();
    if (fileName.includes("ocrfail")) {
      throw new OcrUnavailableError(
        "The mock extractor could not read this file. Enter the fields manually.",
      );
    }

    const mismatch = fileName.includes("mismatch");
    const amount = Number(input.instrument.amount.toString());
    const maturity = new Date(input.instrument.maturityDate);

    const fields: OcrField[] = [
      { name: "bankName", value: input.instrument.bankName, confidence: 0.94 },
      { name: "branch", value: input.instrument.branch ?? "", confidence: 0.72 },
      { name: "fdrNumber", value: input.instrument.fdrNumber, confidence: 0.96 },
      {
        name: "amount",
        value: (mismatch ? Math.max(1, amount - 50_000) : amount).toFixed(2),
        confidence: mismatch ? 0.61 : 0.89,
      },
      { name: "issueDate", value: toIsoDate(input.instrument.issueDate), confidence: 0.93 },
      {
        name: "maturityDate",
        value: toIsoDate(
          mismatch ? new Date(maturity.getTime() - 3 * 86_400_000) : maturity,
        ),
        confidence: mismatch ? 0.57 : 0.84,
      },
      { name: "holderName", value: input.instrument.holderName, confidence: 0.9 },
      {
        name: "declaredLienStatus",
        value: input.instrument.declaredLienStatus,
        confidence: 0.55,
      },
    ];

    return { status: "EXTRACTED", adapter: this.adapter, simulated: true, fields };
  }
}

export function getOcrAdapter(): MockOcrAdapter {
  const adapter = process.env.OCR_ADAPTER ?? "mock";
  if (adapter !== "mock") {
    throw new Error(
      `OCR_ADAPTER="${adapter}" is not available in this prototype. Use "mock".`,
    );
  }
  return new MockOcrAdapter();
}
