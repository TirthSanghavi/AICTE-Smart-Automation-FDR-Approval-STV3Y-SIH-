import { assertSameOrigin, json, readJson, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { updateInstitution } from "@/lib/services/institutions";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.SYSTEM_ADMIN]);
    const { id } = await context.params;
    const body = await readJson(request);
    const institution = await updateInstitution(user, id, body);
    return json({ institution: { id: institution.id, name: institution.name, aicteRef: institution.aicteRef } });
  });
}
