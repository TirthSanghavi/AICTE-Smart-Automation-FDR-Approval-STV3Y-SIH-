import { assertSameOrigin, json, readJson, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { updateInstrument } from "@/lib/services/instruments";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const body = await readJson(request);
    const instrument = await updateInstrument(user, id, body);
    return json({ instrument: { id: instrument.id, versionNo: instrument.versionNo } });
  });
}
