import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { ROLE } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { uploadDocument } from "@/lib/services/documents";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser([ROLE.INSTITUTION_ADMIN]);
    const { id } = await context.params;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError(400, "MALFORMED_FORM", "Upload a single document file.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError(422, "FILE_REQUIRED", "Choose a PDF, JPG or PNG file to upload.");
    }
    const document = await uploadDocument(user, id, file);
    return json(
      {
        document: {
          id: document.id,
          versionNo: document.versionNo,
          sha256: document.sha256,
          mime: document.mime,
          size: document.size,
        },
      },
      201,
    );
  });
}
