import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { submitInstrument } from "@/lib/services/instruments";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;
    const result = await submitInstrument(user, id);
    return json({
      instrument: { id: result.instrument.id, lifecycleStatus: result.instrument.lifecycleStatus },
      findings: result.findings.length,
    });
  });
}
