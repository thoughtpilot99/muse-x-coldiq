import { esc } from "../report";
import type { OfferView } from "./check";
import type { Level } from "./score";

// The shareable Offer Check page (/o/<token>): one self-contained HTML document. It shows the
// computed facts, the score and the explanation; never raw provider data or anyone's name.

export const LEVEL_TEXT: Record<Level, string> = { green: "Healthy", amber: "Watch", red: "Warning", unknown: "Unknown" };
export const LEVEL_COLOR: Record<Level, string> = { green: "#16a34a", amber: "#d97706", red: "#dc2626", unknown: "#8a8a85" };
export const DISCLAIMER = "Not financial or career advice. Based on public data that can be incomplete or late.";

const money = (n: number) => (n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
const list = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

export function scoreLabel(score: number | null) {
  if (score === null) return "Not enough data";
  return score >= 75 ? "Looks healthy" : score >= 45 ? "Mixed signals" : "Several warning signs";
}

export function offerReportHtml(c: OfferView, origin: string): string {
  const f = c.factsData;
  const r = c.resultData;
  const a = c.analysisData;
  if (!f || !r) return "";
  const date = (c.fetched_at ?? c.created_at).slice(0, 10);
  const title = `${f.company.name ?? c.domain}: ${r.score === null ? "not enough data" : `${r.score}/100`}`;
  const description = a?.verdict ?? r.areas.map((x) => `${x.label}: ${LEVEL_TEXT[x.level]}`).join(" · ");
  const card = `${origin}/o/${c.token}/card`;

  const rounds = f.funding.rounds.slice(0, 6).map((x) => `${x.type}${x.amountUsd ? `, ${money(x.amountUsd)}` : ""}${x.date ? `, ${x.date}` : ""}`);
  const newsItems = [...f.news.warnings, ...f.news.departures, ...f.news.positives]
    .sort((x, y) => y.date.localeCompare(x.date))
    .slice(0, 10)
    .map((n) => `${n.date}: ${n.label}`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Offer Check</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${esc(title)} · Offer Check">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(card)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(card)}">
<style>
:root{--bg:#f7f7f5;--fg:#1a1a1a;--panel:#fff;--line:#e4e4df;--muted:#6b6b66;--warn:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0f1012;--fg:#ececec;--panel:#17181b;--line:#2a2c31;--muted:#9a9ca3;--warn:#f0786f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font-size:30px;line-height:1.2;margin:8px 0 12px}h2{font-size:18px;margin:32px 0 8px}h3{font-size:15px;margin:0 0 4px}
.score{display:flex;align-items:baseline;gap:12px;margin:8px 0 4px}.score b{font-size:48px;line-height:1}.score span{color:var(--muted)}
.verdict{font-size:17px}.hint{color:var(--muted);font-size:13px;margin:4px 0}
.areas{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:16px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.badge{display:inline-block;border-radius:999px;padding:1px 10px;font-size:12px;color:#fff;margin-bottom:6px}
.card p{margin:0;font-size:13px}
ul{padding-left:20px;margin:6px 0}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.warn{border-left:3px solid var(--warn);padding:8px 12px;background:var(--panel);margin:8px 0;font-size:13px}
footer{margin-top:40px;color:var(--muted);font-size:12px}
@media (max-width:520px){h1{font-size:24px}.score b{font-size:40px}}
</style></head><body><main>
<div class="eyebrow">Offer Check · ${esc(c.domain)}${f.role ? ` · ${esc(f.role)}` : ""} · ${date}</div>
<h1>${esc(f.company.name ?? c.domain)}</h1>
<div class="score"><b>${r.score ?? "–"}</b><span>${r.score === null ? "" : "/ 100 · "}${scoreLabel(r.score)} · based on ${Math.round(r.coverage * 100)}% of the data areas</span></div>
${a ? `<p class="verdict">${esc(a.verdict)}</p>` : ""}
<div class="areas">${r.areas
    .map((x) => `<div class="card"><span class="badge" style="background:${LEVEL_COLOR[x.level]}">${LEVEL_TEXT[x.level]}</span><h3>${esc(x.label)}</h3><p>${esc(x.reason)}</p></div>`)
    .join("")}</div>
${a ? `<div class="cols">${a.good.length ? `<div class="card"><h3>What looks good</h3>${list(a.good)}</div>` : ""}${a.worries.length ? `<div class="card"><h3>What to watch</h3>${list(a.worries)}</div>` : ""}</div>
<h2>Questions to ask in the interview</h2>${list(a.questions)}` : ""}
<h2>Evidence</h2>
<div class="cols">
<div class="card"><h3>Funding</h3>${rounds.length ? list(rounds) : `<p>No funding rounds found.</p>`}</div>
<div class="card"><h3>Hiring</h3>${f.hiring.known ? list([
    `Open roles now: ${f.hiring.openNow}`,
    `Open roles 90 days ago: ${f.hiring.open90DaysAgo}`,
    `New roles in the last 90 days: ${f.hiring.newLast90} (previous 90 days: ${f.hiring.newPrior90})`,
    ...(f.hiring.roleDepartment ? [`Open ${f.hiring.roleDepartment} roles now: ${f.hiring.roleOpenNow}`] : []),
  ]) : "<p>No job posting data found.</p>"}</div>
<div class="card"><h3>News, last 12 months</h3>${newsItems.length ? list(newsItems) : `<p>${f.news.known ? "Nothing notable." : "No news coverage found."}</p>`}</div>
</div>
${a?.caveats.length ? `<h2>Limits of this check</h2>${list(a.caveats)}` : ""}
${a?.unverified.length ? `<div class="warn"><b>Not verified against the data:</b> ${a.unverified.map(esc).join(" · ")}</div>` : ""}
<footer>${DISCLAIMER} Every number was computed in code from ColdIQ data; the AI only explained it. People are described by role, never by name.<br>
Made with Offer Check in ICP Detective (open source): ColdIQ data + Muse Wonder.</footer>
</main></body></html>`;
}
