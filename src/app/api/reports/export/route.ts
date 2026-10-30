import { json, requireApiUser, withApi } from "@/lib/api";
import { invalid } from "@/lib/errors";
import { REPORT_IDS, reportCsvChunks, type ReportFilters } from "@/lib/services/reports";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApi(request, async () => {
    // Server-side authorization: every session is scoped inside the report
    // engine, so calling this endpoint directly bypasses nothing in the UI.
    const user = await requireApiUser();
    const url = new URL(request.url);
    const params = url.searchParams;
    const report = params.get("report") ?? "institution-exposure";
    if (!REPORT_IDS.includes(report)) {
      throw invalid("Unknown report.", [
        { field: "report", issue: `Report must be one of: ${REPORT_IDS.join(", ")}.` },
      ]);
    }
    const filters: ReportFilters = {
      institutionId: params.get("institutionId") ?? undefined,
      bank: params.get("bank") ?? undefined,
      status: params.get("status") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    };

    const encoder = new TextEncoder();
    const generator = reportCsvChunks(report, user, filters);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await generator.next();
          if (next.done) {
            controller.close();
          } else {
            controller.enqueue(encoder.encode(next.value));
          }
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await generator.return?.(undefined as never);
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${report}-${today}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
}

/** 405 helper keeps the contract explicit if someone POSTs to the export. */
export async function POST() {
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET to export." } }, 405);
}
