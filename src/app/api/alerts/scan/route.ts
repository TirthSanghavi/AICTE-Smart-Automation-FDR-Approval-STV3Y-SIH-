import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { runMaturityScan } from "@/lib/services/maturity";

export async function POST(request: Request) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([
      ROLE.SCRUTINY_OFFICER,
      ROLE.COMPETENT_AUTHORITY,
      ROLE.SYSTEM_ADMIN,
    ]);
    const result = await runMaturityScan(user);
    return json(result);
  });
}
