import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { runExtraction } from "@/lib/services/extraction";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const result = await runExtraction(user, id);
    return json({
      runId: result.run.id,
      status: result.run.status,
      error: result.run.error,
      reused: result.reused,
    });
  });
}
