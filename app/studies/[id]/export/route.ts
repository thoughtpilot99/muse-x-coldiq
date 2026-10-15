import { getStudy, lookalikes, seeds } from "@/lib/db";
import { parseJson } from "@/lib/pipeline";
import type { Profile } from "@/lib/profile";

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const COLUMNS = ["domain", "name", "label", "score", "why", "industry", "employees", "revenue_usd", "country", "founded", "funding_stage", "technologies", "status"] as const;

export async function GET(req: Request, ctx: RouteContext<"/studies/[id]/export">) {
  const { id } = await ctx.params;
  const study = getStudy(Number(id));
  if (!study) return new Response("Not found", { status: 404 });
  const kind = new URL(req.url).searchParams.get("kind") === "seed" ? "seed" : "lookalike";
  const rows = (kind === "seed" ? seeds(study.id) : lookalikes(study.id)).map((c) => {
    const p = parseJson<Profile>(c.profile, {});
    const rec: Record<string, unknown> = {
      ...c, industry: p.industry, employees: p.employees, revenue_usd: p.revenueUsd, country: p.country,
      founded: p.foundedYear, funding_stage: p.fundingStage, technologies: (p.technologies ?? []).join("; "),
    };
    return COLUMNS.map((k) => cell(rec[k])).join(",");
  });
  const slug = study.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "study";
  return new Response([COLUMNS.join(","), ...rows].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${kind === "seed" ? "customers" : "lookalikes"}.csv"`,
    },
  });
}
