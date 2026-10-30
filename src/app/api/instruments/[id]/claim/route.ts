import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { claimInstrument } from "@/lib/services/instruments";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.SCRUTINY_OFFICER]);
    const { id } = await context.params;
    const instrument = await claimInstrument(user, id);
    return json({ instrument: { id: instrument.id, lifecycleStatus: instrument.lifecycleStatus } });
  });
}
