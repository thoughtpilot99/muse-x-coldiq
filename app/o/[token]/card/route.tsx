import { ImageResponse } from "next/og";
import { getOfferCheckByToken } from "@/lib/db";
import { viewOf } from "@/lib/offer/check";
import { LEVEL_COLOR, LEVEL_TEXT, scoreLabel } from "@/lib/offer/report";

// 1200x630 card for X and LinkedIn link previews: company, score and the four areas.
export async function GET(_req: Request, ctx: RouteContext<"/o/[token]/card">) {
  const { token } = await ctx.params;
  const row = /^[A-Za-z0-9_-]{16}$/.test(token) ? getOfferCheckByToken(token) : undefined;
  const c = row ? viewOf(row) : null;
  if (!c?.resultData || !c.factsData) return new Response("Not found", { status: 404 });
  const r = c.resultData;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0f1012", color: "#ececec", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 26, color: "#9a9ca3", letterSpacing: 2 }}>{`OFFER CHECK · ${c.domain}`}</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 16 }}>{c.factsData.company.name ?? c.domain}</div>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 24 }}>
          <div style={{ fontSize: 120, fontWeight: 800 }}>{String(r.score ?? "–")}</div>
          <div style={{ fontSize: 36, color: "#9a9ca3", marginLeft: 16 }}>{`${r.score === null ? "" : "/ 100 · "}${scoreLabel(r.score)}`}</div>
        </div>
        <div style={{ display: "flex", marginTop: "auto", gap: 16 }}>
          {r.areas.map((a) => (
            <div key={a.key} style={{ display: "flex", flexDirection: "column", flex: 1, background: "#17181b", borderRadius: 16, padding: 20, borderTop: `8px solid ${LEVEL_COLOR[a.level]}` }}>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{a.label}</div>
              <div style={{ fontSize: 26, color: LEVEL_COLOR[a.level], marginTop: 6 }}>{LEVEL_TEXT[a.level]}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 20, color: "#9a9ca3", marginTop: 20 }}>Public data via ColdIQ · explained by Muse Wonder · not financial or career advice</div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "X-Robots-Tag": "noindex" } },
  );
}
