import {
  assertSameOrigin,
  json,
  readJson,
  requireApiUser,
  withApi,
} from "@/lib/api";
import { appendAudit, auditTransaction } from "@/lib/audit";
import { ROLE } from "@/lib/constants";
import { parseIsoDate } from "@/lib/dates";
import { demoMode, setDemoDate, testClockEnabled } from "@/lib/demo-clock";
import { invalid, notFound } from "@/lib/errors";

export async function POST(request: Request) {
  return withApi(request, async () => {
    assertSameOrigin(request);
    if (!demoMode() || !testClockEnabled()) throw notFound();
    const user = await requireApiUser([
      ROLE.SCRUTINY_OFFICER,
      ROLE.COMPETENT_AUTHORITY,
      ROLE.SYSTEM_ADMIN,
    ]);
    const body = await readJson(request);
    let date: Date | null = null;
    if (body.date !== null && body.date !== undefined && body.date !== "") {
      try {
        date = parseIsoDate(body.date);
      } catch {
        throw invalid("Enter a valid demo date (YYYY-MM-DD) or clear it.");
      }
    }
    await setDemoDate(date);
    await auditTransaction(async (tx) => {
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: "demo.clock_set",
        entityType: "demo_state",
        entityId: "singleton",
        after: { demoDate: date?.toISOString().slice(0, 10) ?? null },
        reason: "Demo-only frozen clock for reproducible maturity alerts.",
      });
    });
    return json({ demoDate: date?.toISOString().slice(0, 10) ?? null });
  });
}
