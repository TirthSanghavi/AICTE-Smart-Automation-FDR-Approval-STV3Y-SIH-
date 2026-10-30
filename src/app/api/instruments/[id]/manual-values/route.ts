import { assertSameOrigin, json, readJson, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { enterFieldsManually } from "@/lib/services/extraction";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const body = await readJson(request);
    const values =
      body.values && typeof body.values === "object"
        ? (body.values as Record<string, unknown>)
        : body;
    const result = await enterFieldsManually(user, id, values);
    return json({ instrumentId: result.instrument.id, runId: result.run.id });
  });
}
