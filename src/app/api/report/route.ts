import { buildReport, reportCsv } from "@/lib/report";
import { json, snapshot } from "@/lib/server";

export const dynamic = "force-dynamic";

// GET /api/report → JSON · GET /api/report?format=csv → bitácora completa en CSV
export async function GET(req: Request) {
  const { cfg, state, report } = await snapshot();
  const rep = buildReport(cfg, state, report);
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response(reportCsv(rep), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bitacora-${cfg.date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return json(rep);
}
