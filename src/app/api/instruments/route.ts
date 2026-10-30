import { assertSameOrigin, json, readJson, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { createInstrument } from "@/lib/services/instruments";

export async function POST(request: Request) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const body = await readJson(request);
    const instrument = await createInstrument(user, body);
    return json({ instrument: { id: instrument.id, versionNo: instrument.versionNo } }, 201);
  });
}
