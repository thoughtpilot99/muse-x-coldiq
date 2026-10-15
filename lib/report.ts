import type { Study } from "./db";
import type { TraitStat } from "./features";
import { fraction, pct } from "./features";
import type { StoredAnalysis } from "./pipeline";

// The shareable report is one self-contained HTML document (served at /report/<token> and
// downloadable). It shows only aggregates: customer names and domains are never included.

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function bars(t: TraitStat) {
  const row = (label: string, share: number, frac: string, cls: string) => `
    <div class="bar"><span class="bl">${label}</span>
      <span class="track"><span class="fill ${cls}" style="width:${Math.max(2, Math.round(share * 100))}%"></span></span>
      <span class="bv">${frac} · ${pct(share)}</span></div>`;
  return (
    row("Winners", t.winnerShare, fraction(t.winners, t.winnersKnown), "w") +
    (t.loserShare === null ? "" : row("Losers", t.loserShare, fraction(t.losers, t.losersKnown), "l"))
  );
}

function section(title: string, hint: string, refs: { trait_id: string; why: string }[], a: StoredAnalysis) {
  const items = refs.filter((r) => a.refs[r.trait_id]);
  if (!items.length) return "";
  return `<section><h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p>${items
    .map((r) => {
      const t = a.refs[r.trait_id];
      return `<div class="card"><div class="tg">${esc(t.group)}</div><h3>${esc(t.label)}</h3><p>${esc(r.why)}</p>${bars(t)}${
        t.lift ? `<div class="lift">${t.lift.toFixed(1)}× more common among winners</div>` : ""
      }</div>`;
    })
    .join("")}</section>`;
}

export function reportHtml(study: Study, a: StoredAnalysis): string {
  const stats = a.sample;
  const date = new Date(a.generatedAt).toISOString().slice(0, 10);
  const coverage = Object.entries(stats.coverage)
    .sort((x, y) => y[1] - x[1])
    .map(([g, c]) => `<span class="chip">${esc(g)} ${pct(c)}</span>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(study.name)} · ICP report</title>
<style>
:root{--bg:#f7f7f5;--fg:#1a1a1a;--panel:#fff;--line:#e4e4df;--muted:#6b6b66;--w:#4f46e5;--l:#d4544c;--chip:#f0f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#0f1012;--fg:#ececec;--panel:#17181b;--line:#2a2c31;--muted:#9a9ca3;--w:#8b84ff;--l:#f0786f;--chip:#202227}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font-size:30px;line-height:1.2;margin:8px 0 12px}h2{font-size:18px;margin:36px 0 4px}h3{font-size:16px;margin:2px 0 6px}
.summary{font-size:17px}.hint{color:var(--muted);margin:0 0 12px;font-size:13px}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px}
.stat b{display:block;font-size:22px}.stat span{font-size:12px;color:var(--muted)}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:2px 10px;margin:2px;font-size:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:10px 0}
.card p{margin:0 0 10px}.tg{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.bar{display:grid;grid-template-columns:64px 1fr 110px;align-items:center;gap:8px;font-size:12px;margin:4px 0}
.track{height:8px;background:var(--chip);border-radius:99px;overflow:hidden}.fill{display:block;height:100%}.fill.w{background:var(--w)}.fill.l{background:var(--l)}
.bv{text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}.bl{color:var(--muted)}
.lift{margin-top:6px;font-size:12px;color:var(--w)}
.warn{border-left:3px solid var(--l);padding:8px 12px;background:var(--panel);margin:8px 0;font-size:13px}
ul{padding-left:20px}footer{margin-top:48px;color:var(--muted);font-size:12px}
@media (max-width:520px){.bar{grid-template-columns:52px 1fr 92px}h1{font-size:24px}}
</style></head><body><main>
<div class="eyebrow">ICP report · ${esc(study.name)} · ${date}</div>
<h1>${esc(a.headline)}</h1>
<p class="summary">${esc(a.icp_summary)}</p>
<div class="stats">
  <div class="stat"><b>${stats.winners}</b><span>best customers analysed</span></div>
  <div class="stat"><b>${stats.losers || "none"}</b><span>churned or lost, for comparison</span></div>
  <div class="stat"><b>${stats.traitCount}</b><span>traits with enough support</span></div>
</div>
<p class="hint">Data coverage: ${coverage || "none"}</p>
${section("Must-have traits", "What most clearly separates the best customers from the rest.", a.must_have, a)}
${section("Nice to have", "Positive, but weaker evidence.", a.nice_to_have, a)}
${section("Anti-ICP", "More common among churned or lost accounts. Be careful here.", a.anti_icp, a)}
${section("Surprises", "Patterns worth a second look.", a.surprises, a)}
<section><h2>Caveats</h2><ul>${a.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
${a.unverified.length ? `<div class="warn"><b>Not verified against the data:</b> ${a.unverified.map(esc).join(" · ")}</div>` : ""}</section>
<footer>Every count above was computed in code from the customer list; the AI only interpreted the table. Customer names are not included in this report.<br>
Made with ICP Detective (open source): ColdIQ data + Muse Wonder.</footer>
</main></body></html>`;
}
