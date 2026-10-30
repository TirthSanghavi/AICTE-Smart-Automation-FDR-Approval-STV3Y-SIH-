import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  requiredString,
  withApi,
} from "@/lib/api";
import { invalid } from "@/lib/errors";
import { completeTask } from "@/lib/services/cases";

type Context = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { id, taskId } = await context.params;
    const body = await readJson(request);
    const outcome = requiredString(body, "outcome", "Outcome");
    if (!["SATISFIED", "NOT_SATISFIED"].includes(outcome)) {
      throw invalid("Choose SATISFIED or NOT_SATISFIED.");
    }
    const notes = requiredString(body, "notes", "Task notes", 2000);
    const task = await completeTask(user, id, taskId, {
      outcome: outcome as "SATISFIED" | "NOT_SATISFIED",
      notes,
    });
    return json({ taskId: task.id, status: task.status, outcome: task.outcome });
  });
}
