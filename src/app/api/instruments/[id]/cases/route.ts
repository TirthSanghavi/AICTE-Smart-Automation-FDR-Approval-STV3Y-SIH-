import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  requiredString,
  withApi,
} from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { createCase } from "@/lib/services/cases";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const body = await readJson(request);
    const type = requiredString(body, "type", "Case type");
    const reason = requiredString(body, "reason", "Reason", 2000);
    const releaseCase = await createCase(user, id, { type, reason });
    return json({ caseId: releaseCase.id }, 201);
  });
}
