export type SimulatedVerification = {
  status: "CONFIRMED" | "UNAVAILABLE" | "INCONCLUSIVE";
  lienStatus: "LIEN_CONFIRMED" | "NO_LIEN" | "UNKNOWN";
  sourceName: string;
  reference: string;
  asOf: Date;
  simulated: true;
  attempts: number;
  errorCode?: string;
  notes: string;
};

type SimulatorInput = {
  fdrNumber: string;
  bankName: string;
  amount: { toString(): string };
  requestId: string;
};

/**
 * Prototype-only simulator. There is no live bank interface. Any FDR number
 * containing "UNAVAILABLE" exercises the timeout path; every other request
 * returns a synthetic success that MUST be stored as SIMULATED_RESULT.
 */
export async function simulateBankVerification(
  input: SimulatorInput,
): Promise<SimulatedVerification> {
  const asOf = new Date();
  const unavailable = input.fdrNumber.toUpperCase().includes("UNAVAILABLE");
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!unavailable) {
      return {
        status: "CONFIRMED",
        lienStatus: "LIEN_CONFIRMED",
        sourceName: "Prototype bank simulator (not a bank)",
        reference: `SIM-${input.requestId.slice(0, 8).toUpperCase()}`,
        asOf,
        simulated: true,
        attempts: attempt,
        notes:
          "Synthetic response from the prototype simulator. It is not a bank confirmation and has no evidentiary value.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 5 * attempt));
  }

  return {
    status: "UNAVAILABLE",
    lienStatus: "UNKNOWN",
    sourceName: "Prototype bank simulator (not a bank)",
    reference: `SIM-${input.requestId.slice(0, 8).toUpperCase()}`,
    asOf,
    simulated: true,
    attempts: maxAttempts,
    errorCode: "SIMULATED_TIMEOUT",
    notes:
      "The simulator timed out after 3 attempts. No positive or negative bank result is inferred; manual follow-up is required.",
  };
}
