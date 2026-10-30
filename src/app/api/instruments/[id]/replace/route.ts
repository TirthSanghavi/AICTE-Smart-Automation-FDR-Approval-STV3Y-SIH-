import { assertSameOrigin, json, readJson, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { replaceInstrument } from "@/lib/services/replacements";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const body = await readJson(request);
    const successor = await replaceInstrument(user, id, body);
    return json(
      {
        instrument: { id: successor.id, fdrNumber: successor.fdrNumber },
        predecessorId: successor.replacesId,
      },
      201,
    );
  });
}
