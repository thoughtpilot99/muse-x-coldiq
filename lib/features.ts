import type { Label } from "./db";
import type { Profile } from "./profile";

// Traits are computed in code so every number in the report can be checked. Muse Wonder
// only interprets the resulting table; it never counts anything itself.

export type Trait = { id: string; group: string; label: string };

export type Subject = { label: Label | null; profile: Profile; custom: Record<string, string>; dealValue?: number | null };

const bucket = (n: number, edges: [number, string][], last: string) => edges.find(([max]) => n <= max)?.[1] ?? last;

export const headcountBand = (n: number) =>
  bucket(n, [[10, "1-10"], [50, "11-50"], [200, "51-200"], [1000, "201-1,000"], [5000, "1,001-5,000"]], "5,000+");

export const revenueBand = (n: number) =>
  bucket(n, [[1e6, "under $1M"], [1e7, "$1M-10M"], [5e7, "$10M-50M"], [2.5e8, "$50M-250M"]], "$250M+");

export const ageBand = (founded: number, now = new Date().getFullYear()) =>
  bucket(now - founded, [[3, "0-3 years old"], [7, "4-7 years old"], [15, "8-15 years old"]], "15+ years old");

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const slug = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function normalizeStage(s: string): string {
  const t = s.toLowerCase().replace(/[_-]/g, " ");
  if (/pre ?seed|angel/.test(t)) return "Pre-seed";
  if (/seed/.test(t)) return "Seed";
  const series = t.match(/series ?([a-j])/);
  if (series) return ["a", "b"].includes(series[1]) ? `Series ${series[1].toUpperCase()}` : "Series C+";
  if (/ipo|public/.test(t)) return "Public";
  if (/private equity|buyout|pe\b/.test(t)) return "Private equity";
  if (/acquired|m&a/.test(t)) return "Acquired";
  if (/bootstrap|self/.test(t)) return "Bootstrapped";
  return clean(s).slice(0, 40);
}

/** Groups whose data is known for this subject. Missing data never counts as "doesn't have the trait". */
export function knownGroups(s: Subject): Set<string> {
  const p = s.profile;
  const known = new Set<string>();
  if (p.industry) known.add("Industry");
  if (p.employees) known.add("Headcount");
  if (p.revenueUsd) known.add("Revenue");
  if (p.country) known.add("Country");
  if (p.foundedYear) known.add("Company age");
  if (p.fundingStage) known.add("Funding");
  if (p.technologies?.length) known.add("Tech stack");
  if (p.hiring) known.add("Hiring");
  if (p.ads) known.add("Advertising");
  for (const [col, v] of Object.entries(s.custom)) if (v) known.add(col);
  return known;
}

export function traitsOf(s: Subject): Trait[] {
  const p = s.profile;
  const t: Trait[] = [];
  const add = (group: string, label: string) => t.push({ id: `${slug(group)}:${slug(label)}`, group, label });
  if (p.industry) add("Industry", clean(p.industry));
  if (p.employees) add("Headcount", `${headcountBand(p.employees)} employees`);
  if (p.revenueUsd) add("Revenue", `Revenue ${revenueBand(p.revenueUsd)}`);
  if (p.country) add("Country", clean(p.country).toUpperCase().length <= 3 ? clean(p.country).toUpperCase() : clean(p.country));
  if (p.foundedYear) add("Company age", ageBand(p.foundedYear));
  if (p.fundingStage) add("Funding", normalizeStage(p.fundingStage));
  for (const tech of new Set((p.technologies ?? []).map(clean))) add("Tech stack", `Uses ${tech}`);
  if (p.hiring) {
    for (const [dept, n] of Object.entries(p.hiring.departments)) if (n > 0) add("Hiring", `Hiring in ${dept}`);
    add("Hiring", p.hiring.total >= 10 ? "Hiring actively (10+ open roles)" : p.hiring.total > 0 ? "Hiring a little (1-9 open roles)" : "Not hiring");
  }
  if (p.ads) {
    add("Advertising", p.ads.count > 0 ? "Runs ads" : "No ads found");
    for (const pl of p.ads.platforms) add("Advertising", `Advertises on ${pl[0].toUpperCase()}${pl.slice(1)}`);
  }
  for (const [col, v] of Object.entries(s.custom)) if (v) add(col, `${col}: ${clean(v)}`);
  // Same label twice (e.g. a tech listed twice) counts once.
  return [...new Map(t.map((x) => [x.id, x])).values()];
}

export type TraitStat = Trait & {
  winners: number; // winners with the trait
  winnersKnown: number; // winners whose data for this group is known
  losers: number;
  losersKnown: number;
  winnerShare: number;
  loserShare: number | null;
  lift: number | null; // smoothed winner share / loser share
  avgValueWith: number | null; // average deal value of winners with the trait
  avgValueWithout: number | null;
  score: number;
};

export type StudyStats = {
  winners: number;
  losers: number;
  hasLosers: boolean;
  coverage: Record<string, number>; // group -> share of subjects with known data
  traits: TraitStat[];
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeStats(subjects: Subject[], minSupport = 3): StudyStats {
  const W = subjects.filter((s) => s.label === "winner");
  const L = subjects.filter((s) => s.label === "loser");
  const rows = subjects.map((s) => ({ s, traits: new Set(traitsOf(s).map((t) => t.id)), known: knownGroups(s) }));
  const all = new Map<string, Trait>();
  for (const s of subjects) for (const t of traitsOf(s)) all.set(t.id, t);

  const groups = new Set([...all.values()].map((t) => t.group));
  const coverage = Object.fromEntries(
    [...groups].map((g) => [g, subjects.length ? rows.filter((r) => r.known.has(g)).length / subjects.length : 0]),
  );

  const traits: TraitStat[] = [];
  for (const t of all.values()) {
    const inGroup = (label: Label) => rows.filter((r) => r.s.label === label && r.known.has(t.group));
    const wk = inGroup("winner");
    const lk = inGroup("loser");
    const w = wk.filter((r) => r.traits.has(t.id));
    const l = lk.filter((r) => r.traits.has(t.id)).length;
    if (w.length < minSupport && l < minSupport) continue;
    const winnerShare = wk.length ? w.length / wk.length : 0;
    const loserShare = lk.length ? l / lk.length : null;
    // Laplace smoothing keeps small samples from producing infinite lifts.
    const lift = lk.length ? (w.length + 1) / (wk.length + 2) / ((l + 1) / (lk.length + 2)) : null;
    const values = (rs: typeof rows) => rs.map((r) => r.s.dealValue).filter((v): v is number => typeof v === "number" && v > 0);
    const without = wk.filter((r) => !r.traits.has(t.id));
    const score = loserShare === null
      ? winnerShare * Math.sqrt(w.length)
      : (winnerShare - loserShare) * Math.sqrt(Math.max(w.length, l));
    traits.push({
      ...t,
      winners: w.length, winnersKnown: wk.length, losers: l, losersKnown: lk.length,
      winnerShare, loserShare, lift,
      avgValueWith: avg(values(w)), avgValueWithout: avg(values(without)),
      score,
    });
  }
  traits.sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.winners - a.winners);
  return { winners: W.length, losers: L.length, hasLosers: L.length > 0, coverage, traits };
}

export const fraction = (n: number, d: number) => `${n}/${d}`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
