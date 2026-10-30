import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { acknowledgeAlert } from "@/lib/services/maturity";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const alert = await acknowledgeAlert(user, id);
    return json({ alertId: alert.id, status: alert.status });
  });
}
