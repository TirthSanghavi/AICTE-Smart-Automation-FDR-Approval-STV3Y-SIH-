import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  requiredString,
  withApi,
} from "@/lib/api";
import { CASE_DISCLAIMER, ROLE } from "@/lib/constants";
import { decideCase } from "@/lib/services/cases";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.COMPETENT_AUTHORITY]);
    const { id } = await context.params;
    const body = await readJson(request);
    const decision = await decideCase(user, id, {
      outcome: requiredString(body, "outcome", "Decision outcome"),
      reason: requiredString(body, "reason", "Decision reason", 2000),
    });
    return json({
      decisionId: decision.id,
      outcome: decision.outcome,
      disclaimer: CASE_DISCLAIMER,
    });
  });
}
