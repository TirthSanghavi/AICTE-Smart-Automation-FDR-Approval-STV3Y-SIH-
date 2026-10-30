import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  requiredString,
  withApi,
} from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { invalid } from "@/lib/errors";
import { recordClearance } from "@/lib/services/cases";
import { parseIsoDate } from "@/lib/dates";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.DEPT_REVIEWER, ROLE.SCRUTINY_OFFICER]);
    const { id } = await context.params;
    const body = await readJson(request);
    let issuedOn: Date;
    try {
      issuedOn = parseIsoDate(body.issuedOn);
    } catch {
      throw invalid("Enter a valid issue date for the clearance.");
    }
    const clearance = await recordClearance(user, id, {
      kind: requiredString(body, "kind", "Clearance type", 80),
      issuer: requiredString(body, "issuer", "Issuer", 200),
      reference: requiredString(body, "reference", "Reference", 120),
      issuedOn,
      scope: requiredString(body, "scope", "Scope", 1000),
    });
    return json({ clearanceId: clearance.id }, 201);
  });
}
