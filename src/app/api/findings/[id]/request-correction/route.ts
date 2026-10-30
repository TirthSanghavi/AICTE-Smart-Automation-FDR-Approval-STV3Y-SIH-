import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  requiredString,
  stringArray,
  withApi,
} from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { invalid } from "@/lib/errors";
import { requestCorrection } from "@/lib/services/findings";
import { parseIsoDate } from "@/lib/dates";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.SCRUTINY_OFFICER]);
    const { id } = await context.params;
    const body = await readJson(request);
    const reason = requiredString(body, "reason", "Correction reason", 1000);
    let dueDate: Date | null = null;
    if (typeof body.dueDate === "string" && body.dueDate) {
      try {
        dueDate = parseIsoDate(body.dueDate);
      } catch {
        throw invalid("Enter a valid correction due date.");
      }
    }
    const instrument = await requestCorrection(user, id, {
      reason,
      dueDate,
      requestedFields: stringArray(body, "requestedFields"),
    });
    return json({ instrumentId: instrument.id, lifecycleStatus: instrument.lifecycleStatus });
  });
}
