import { assertSameOrigin, json, requireApiUser, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const notification = await prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { status: "READ", readAt: new Date() },
    });
    if (notification.count === 0) throw notFound();
    return json({ ok: true });
  });
}
