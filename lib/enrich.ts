import { coldiq, ColdiqError } from "./coldiq";
import { allowance, CreditCapError } from "./credits";
import type { Company } from "./db";
import { ads, firmographics, hiring, type Profile } from "./profile";

/** What ColdIQ is asked about each company. Each lens is one paid call per company. */
export const LENSES = {
  firmographics: { label: "Firmographics", detail: "Industry, headcount, revenue, country, founding year, funding, tech stack" },
  hiring: { label: "Hiring", detail: "Open roles in the last 90 days, grouped by department" },
  ads: { label: "Advertising", detail: "Whether the company runs ads, and on which platforms" },
} as const;
export type Lens = keyof typeof LENSES;
export const isLens = (v: string): v is Lens => v in LENSES;

type Json = Record<string, unknown>;
const data = (body: unknown) => {
  const b = (body ?? {}) as Json;
  return b.data ?? b;
};
const missed = (body: unknown) => (body as Json | null)?.found === false;

/**
 * One lens for one company. max_credits is the smallest remaining cap (day, run, company),
 * so ColdIQ refuses any provider that would cost more and the caps can never be exceeded.
 */
export async function runLens(c: Company, lens: Lens): Promise<Partial<Profile>> {
  const a = allowance(c.id);
  if (a.credits <= 0) throw new CreditCapError(a.cap);
  const base = { studyId: c.study_id, companyId: c.id };
  const common = { max_credits: Math.floor(a.credits * 100) / 100, soft_miss: true };
  try {
    if (lens === "firmographics") {
      const body = await coldiq("/v1/company/enrich", { ...base, body: { input: { domain: c.domain }, ...common } });
      return missed(body) ? {} : firmographics(data(body));
    }
    if (lens === "hiring") {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const body = await coldiq("/v1/jobs/search", {
        ...base,
        body: { input: { company_domains: [c.domain], posted_after: since, limit: 50 }, ...common },
      });
      return { hiring: missed(body) ? { total: 0, departments: {} } : hiring(data(body)) };
    }
    const body = await coldiq("/v1/ads/search", {
      ...base,
      body: { input: { query: c.name || c.domain, domains: [c.domain], max_results: 5 }, ...common },
    });
    const provider = String(((body as Json)._meta as Json | undefined)?.provider ?? "");
    return { ads: missed(body) ? { count: 0, platforms: [] } : ads(data(body), provider) };
  } catch (e) {
    // A miss is an answer ("no ads", "no open roles"), not a failure.
    if (e instanceof ColdiqError && e.status === 404) return lens === "firmographics" ? {} : lens === "hiring" ? { hiring: { total: 0, departments: {} } } : { ads: { count: 0, platforms: [] } };
    throw e;
  }
}

export function mergeProfile(current: string | null, patch: Partial<Profile>): Profile {
  const base: Profile = current ? JSON.parse(current) : {};
  return { ...base, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
}
