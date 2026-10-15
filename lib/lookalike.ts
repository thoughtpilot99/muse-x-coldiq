import type { Analysis } from "./agents";
import type { TraitStat } from "./features";
import { knownGroups, traitsOf, type Subject } from "./features";
import { firmographics, records, type Profile } from "./profile";
import { normalizeDomain } from "./csv";

/** Filters for ColdIQ companies/search: lookalikes of the best winners, narrowed by the ICP. */
export function searchFilters(analysis: Analysis, seedDomains: string[], limit: number): Record<string, unknown> {
  const s = analysis.search;
  const f: Record<string, unknown> = { similar_to_domains: seedDomains.slice(0, 5), limit };
  if (s.countries.length) f.countries = s.countries.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  if (s.min_employees) f.min_employees = Math.max(1, Math.round(s.min_employees));
  if (s.max_employees) f.max_employees = Math.round(s.max_employees);
  if (s.technologies.length) {
    f.technologies = s.technologies.slice(0, 5);
    f.technologies_mode = "SMART";
  }
  return f;
}

export type Candidate = { domain: string; name: string | null; profile: Profile };

/** Company records from a companies/search response. */
export function candidates(body: unknown): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const r of records(body, ["domain", "website", "company_domain", "name"])) {
    const domain = normalizeDomain(String(r.domain ?? r.website ?? r.company_domain ?? r.url ?? ""));
    if (!domain || out.has(domain)) continue;
    const profile = firmographics(r);
    out.set(domain, { domain, name: profile.name ?? null, profile });
  }
  return [...out.values()];
}

const WEIGHT = { must_have: 3, nice_to_have: 1, anti_icp: -2 } as const;

/**
 * Score a candidate 0-100 against the ICP traits. Only traits whose group is known for the
 * candidate count; the rest are listed as unknown instead of silently counting as a miss.
 */
export function scoreCandidate(p: Profile, analysis: Analysis, refs: Record<string, TraitStat>) {
  const subject: Subject = { label: null, profile: p, custom: {} };
  const has = new Set(traitsOf(subject).map((t) => t.id));
  const known = knownGroups(subject);
  let got = 0, possible = 0;
  const matched: string[] = [], missed: string[] = [], warnings: string[] = [], unknown: string[] = [];
  for (const kind of ["must_have", "nice_to_have", "anti_icp"] as const) {
    for (const ref of analysis[kind]) {
      const t = refs[ref.trait_id];
      if (!t) continue;
      if (!known.has(t.group)) {
        unknown.push(t.label);
        continue;
      }
      const w = WEIGHT[kind];
      if (w > 0) {
        possible += w;
        if (has.has(t.id)) {
          got += w;
          matched.push(t.label);
        } else missed.push(t.label);
      } else if (has.has(t.id)) {
        got += w;
        warnings.push(t.label);
      }
    }
  }
  const score = possible ? Math.max(0, Math.round((got / possible) * 100)) : null;
  const why = [
    matched.length ? `Matches: ${matched.join(", ")}` : "",
    missed.length ? `Missing: ${missed.join(", ")}` : "",
    warnings.length ? `Warning: ${warnings.join(", ")}` : "",
    unknown.length ? `Unknown: ${unknown.join(", ")}` : "",
  ].filter(Boolean).join(". ");
  return { score, why: why || "No ICP traits could be checked with the data available." };
}
