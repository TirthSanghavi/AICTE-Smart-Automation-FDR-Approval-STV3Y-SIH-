import { assertSameOrigin, json, readJson, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { recordEndorsement } from "@/lib/services/endorsements";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([
      ROLE.INSTITUTION_ADMIN,
      ROLE.SCRUTINY_OFFICER,
      ROLE.COMPETENT_AUTHORITY,
    ]);
    const { id } = await context.params;
    const body = await readJson(request);
    const endorsement = await recordEndorsement(user, id, body);
    return json({ endorsement: { id: endorsement.id, status: endorsement.status } }, 201);
  });
}
