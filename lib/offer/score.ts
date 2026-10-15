import { SEVERE, type Facts, type NewsItem } from "./facts";

// Plain rules, written down in the README, so anyone can check why an area got its colour.
// Missing data is "unknown" and left out of the score; it never counts against a company.

export type Level = "green" | "amber" | "red" | "unknown";
export type AreaKey = "funding" | "hiring" | "team" | "news";
export type AreaResult = { key: AreaKey; label: string; weight: number; level: Level; reason: string };
export type ScoreResult = { areas: AreaResult[]; score: number | null; coverage: number };

export const WEIGHTS: Record<AreaKey, number> = { funding: 30, hiring: 30, team: 20, news: 20 };
const POINTS: Record<Exclude<Level, "unknown">, number> = { green: 100, amber: 50, red: 0 };
const pct = (n: number) => `${Math.round(n * 100)}%`;
const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function fundingArea(f: Facts): AreaResult {
  const base = { key: "funding" as const, label: "Funding", weight: WEIGHTS.funding };
  const { monthsSince, last } = f.funding;
  if (monthsSince === null || !last) {
    return { ...base, level: "unknown", reason: "No venture funding found. The company may be bootstrapped, profitable or public." };
  }
  // Time since the last round is the only funding rule. Runway can't be estimated from public
  // data without revenue, so it is left to the interview questions instead of guessed.
  let level: Level = monthsSince <= 18 ? "green" : monthsSince <= 30 ? "amber" : "red";
  // Large companies are often profitable and raise rarely: a long gap is a question, not a red flag.
  const late = (f.company.headcount ?? 0) >= 1000;
  if (late && level === "red") level = "amber";
  const parts = [`Last round: ${last.type}${last.date ? ` (${s(monthsSince, "month")} ago)` : ""}.`];
  if (monthsSince > 18) parts.push(late ? "Large companies often fund themselves, so ask about profitability." : "Ask how long the current funding lasts.");
  return { ...base, level, reason: parts.join(" ") };
}

export function hiringArea(f: Facts): AreaResult {
  const base = { key: "hiring" as const, label: "Hiring", weight: WEIGHTS.hiring };
  const h = f.hiring;
  if (!h.known) return { ...base, level: "unknown", reason: "No job posting data found." };
  if (h.noneConfirmed && h.openNow === 0) return { ...base, level: "red", reason: "No open roles: the careers page was checked and is empty." };
  let level: Level;
  let reason: string;
  if (h.open90DaysAgo === 0) {
    level = h.openNow > 0 ? "green" : "amber";
    reason = `${s(h.openNow, "open role")} now, none 90 days ago.`;
  } else {
    const ratio = h.openNow / h.open90DaysAgo;
    level = ratio >= 0.8 ? "green" : ratio >= 0.4 ? "amber" : "red";
    reason = `${s(h.openNow, "open role")} now vs ${h.open90DaysAgo} 90 days ago (${pct(ratio)}).`;
  }
  reason += ` New roles: ${h.newLast90} in the last 90 days, ${h.newPrior90} in the 90 days before.`;
  return { ...base, level, reason };
}

export function teamArea(f: Facts): AreaResult {
  const base = { key: "team" as const, label: "Team", weight: WEIGHTS.team };
  const g = f.company.growthPct;
  if (g === undefined) return { ...base, level: "unknown", reason: "No headcount growth data found." };
  const level: Level = g >= 0 ? "green" : g >= -10 ? "amber" : "red";
  const size = f.company.headcount ? `${f.company.headcount.toLocaleString("en-US")} people, ` : "";
  return { ...base, level, reason: `${size}${g >= 0 ? "+" : ""}${g}% headcount growth over the last year.` };
}

/** "Security, product or legal incident reported (29, latest 2026-09-22)": one line per kind of item. */
export function groupNews(items: NewsItem[]): string[] {
  const groups = new Map<string, NewsItem[]>();
  for (const i of items) groups.set(i.label, [...(groups.get(i.label) ?? []), i]);
  return [...groups].map(([label, list]) => {
    const latest = list.map((i) => i.date).sort().at(-1);
    return list.length === 1 ? `${label} (${latest})` : `${label} (${list.length}, latest ${latest})`;
  });
}

export function newsArea(f: Facts): AreaResult {
  const base = { key: "news" as const, label: "News", weight: WEIGHTS.news };
  const n = f.news;
  if (!n.known) return { ...base, level: "unknown", reason: "No news coverage found." };
  // Red: layoffs, office closures, or two or more senior leaders leaving. Amber: anything else
  // worth asking about (incidents, mergers, one departure). Repeats of one kind count once.
  const severe = n.warnings.some((w) => SEVERE.has(w.category)) || n.departures.length >= 2;
  const flags = n.warnings.length + n.departures.length;
  const level: Level = severe ? "red" : flags ? "amber" : "green";
  const reason = flags
    ? `In the last 12 months: ${groupNews([...n.warnings, ...n.departures]).join("; ")}.`
    : `No warning signs in the last 12 months${n.positives.length ? `; ${s(n.positives.length, "positive item")}` : ""}.`;
  return { ...base, level, reason };
}

export function scoreFacts(f: Facts): ScoreResult {
  const areas = [fundingArea(f), hiringArea(f), teamArea(f), newsArea(f)];
  const known = areas.filter((a) => a.level !== "unknown");
  const weight = known.reduce((n, a) => n + a.weight, 0);
  const coverage = weight / 100;
  const score = coverage < 0.5
    ? null
    : Math.round(known.reduce((n, a) => n + a.weight * POINTS[a.level as Exclude<Level, "unknown">], 0) / weight);
  return { areas, score, coverage };
}
