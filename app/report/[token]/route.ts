import { getStudyByToken } from "@/lib/db";
import { parseJson, type StoredAnalysis } from "@/lib/pipeline";
import { reportHtml } from "@/lib/report";

// Public, read-only report. The token is unguessable; the page shows only aggregates.
export async function GET(req: Request, ctx: RouteContext<"/report/[token]">) {
  const { token } = await ctx.params;
  const study = /^[A-Za-z0-9_-]{16}$/.test(token) ? getStudyByToken(token) : undefined;
  const analysis = parseJson<StoredAnalysis | null>(study?.analysis, null);
  if (!study || !analysis) return new Response("Report not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const slug = study.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "icp";
  return new Response(reportHtml(study, analysis), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      ...(download ? { "Content-Disposition": `attachment; filename="${slug}-icp-report.html"` } : {}),
    },
  });
}
