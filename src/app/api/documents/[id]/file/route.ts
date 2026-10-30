import { requireApiUser, withApi } from "@/lib/api";
import { getDocumentForUser } from "@/lib/services/documents";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(request: Request, context: Context) {
  return withApi(request, async () => {
    const user = await requireApiUser();
    const { id } = await context.params;
    const { document, bytes } = await getDocumentForUser(user, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": document.mime,
        "content-length": String(bytes.length),
        "content-disposition": `inline; filename="${document.originalName.replace(/["\\]/g, "")}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  });
}
