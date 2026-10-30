import {
  assertSameOrigin,
  json,
  optionalString,
  readJson,
  requireApiUser,
  requiredString,
  withApi,
} from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { invalid } from "@/lib/errors";
import { recordVerification } from "@/lib/services/verification";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([
      ROLE.SCRUTINY_OFFICER,
      ROLE.COMPETENT_AUTHORITY,
      ROLE.SERVICE_ACCOUNT,
    ]);
    const { id } = await context.params;
    const body = await readJson(request);
    const method = requiredString(body, "method", "Verification method") as
      | "SIMULATED"
      | "MANUAL_CONFIRMATION"
      | "OFFICIAL_BANK_API";
    if (!["SIMULATED", "MANUAL_CONFIRMATION", "OFFICIAL_BANK_API"].includes(method)) {
      throw invalid("Choose a verification method.");
    }

    const isManual = method === "MANUAL_CONFIRMATION";
    const sourceName = isManual
      ? requiredString(body, "sourceName", "Source name", 200)
      : optionalString(body, "sourceName", 200) ?? "Prototype bank simulator (not a bank)";
    const reference = isManual
      ? requiredString(body, "reference", "Source reference", 200)
      : optionalString(body, "reference", 200) ?? `SIM-${Date.now().toString(36).toUpperCase()}`;
    const notes = isManual
      ? requiredString(body, "notes", "Review notes", 2000)
      : optionalString(body, "notes", 2000) ?? "Synthetic simulator run.";
    const limitations = optionalString(body, "limitations", 2000) ?? "";
    const overrideReason = optionalString(body, "overrideReason", 1000);

    let asOf = new Date();
    if (typeof body.asOf === "string" && body.asOf) {
      const parsed = new Date(body.asOf);
      if (Number.isNaN(parsed.getTime())) {
        throw invalid("Enter a valid source date.");
      }
      asOf = parsed;
    }

    const result = await recordVerification(user, id, {
      method,
      sourceName,
      reference,
      asOf,
      notes,
      limitations,
      evidenceDocumentId: optionalString(body, "evidenceDocumentId", 100),
      overrideReason,
    });
    return json({
      attemptId: result.attempt.id,
      verificationStatus: result.instrument.verificationStatus,
      lifecycleStatus: result.instrument.lifecycleStatus,
    });
  });
}
