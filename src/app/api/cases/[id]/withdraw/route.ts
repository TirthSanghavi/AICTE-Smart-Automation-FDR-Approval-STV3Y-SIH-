import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { withdrawCase } from "@/lib/services/cases";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const releaseCase = await withdrawCase(user, id);
    return json({ caseId: releaseCase.id, status: releaseCase.status });
  });
}
