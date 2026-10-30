import { assertSameOrigin, json, readJson, requiredString, withApi } from "@/lib/api";
import { login } from "@/lib/services/session";

export async function POST(request: Request) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const body = await readJson(request);
    const email = requiredString(body, "email", "Email", 200);
    const password = requiredString(body, "password", "Password", 200);
    const user = await login(email, password);
    return json({ user });
  });
}
