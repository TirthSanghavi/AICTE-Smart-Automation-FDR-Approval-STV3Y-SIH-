import { assertSameOrigin, json, withApi } from "@/lib/api";
import { logout } from "@/lib/services/session";

export async function POST(request: Request) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    await logout();
    return json({ ok: true });
  });
}
