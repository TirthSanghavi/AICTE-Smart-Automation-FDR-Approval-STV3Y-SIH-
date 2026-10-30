import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  requiredString,
  withApi,
} from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { closeInstrument } from "@/lib/services/cases";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.COMPETENT_AUTHORITY]);
    const { id } = await context.params;
    const body = await readJson(request);
    const reason = requiredString(body, "reason", "Closure reason", 1000);
    const instrument = await closeInstrument(user, id, reason);
    return json({ instrumentId: instrument.id, lifecycleStatus: instrument.lifecycleStatus });
  });
}
