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
import { resolveFinding } from "@/lib/services/findings";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([
      ROLE.SCRUTINY_OFFICER,
      ROLE.COMPETENT_AUTHORITY,
    ]);
    const { id } = await context.params;
    const body = await readJson(request);
    const resolution = requiredString(body, "resolution", "Resolution");
    if (!["RESOLVED", "DISMISSED_FALSE_POSITIVE"].includes(resolution)) {
      throw invalid("Choose a valid resolution.");
    }
    const reason = requiredString(body, "reason", "Resolution reason", 1000);
    const result = await resolveFinding(user, id, {
      resolution: resolution as "RESOLVED" | "DISMISSED_FALSE_POSITIVE",
      reason,
    });
    return json(result);
  });
}
