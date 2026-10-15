import { randomBytes } from "node:crypto";
import { coldiq, ColdiqError } from "../coldiq";
import { config } from "../config";
import { allowance, CreditCapError, currentRunId, withRun } from "../credits";
import { normalizeDomain } from "../csv";
import { get, getOfferCheck, logEvent, run, updateOfferCheck, type OfferCheck } from "../db";
import { getSettings } from "../settings";
import { explainOffer, type OfferAnalysis } from "./agent";
import { buildFacts, type Facts, type RawSources, type Source, type SourceState } from "./facts";
import { scoreFacts, type ScoreResult } from "./score";

// One Offer Check: four ColdIQ calls (about 11 credits), cached per domain for 7 days, then
// facts and score in code, then the explanation from Muse Wonder.

export const CACHE_DAYS = 7;
const DAY = 86_400_000;
const SOURCES: Source[] = ["enrich", "financing", "jobs", "news"];
/** Expected price of each call, so a call is skipped (not cut short) when the check's budget can't cover it. */
const PRICE: Record<Source, number> = { enrich: 3.5, financing: 2.52, jobs: 2.52, news: 2.52 };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export type OfferView = OfferCheck & {
  factsData: Facts | null;
  resultData: ScoreResult | null;
  analysisData: OfferAnalysis | null;
};

export const viewOf = (c: OfferCheck): OfferView => ({
  ...c,
  factsData: json<Facts | null>(c.facts, null),
  resultData: json<ScoreResult | null>(c.result, null),
  analysisData: json<OfferAnalysis | null>(c.analysis, null),
});

export function createOfferCheck(input: { website: string; role?: string }): number {
  const domain = normalizeDomain(input.website);
  if (!domain) throw new Error("Enter a company website, like linear.app.");
  const role = input.role?.trim().slice(0, 120) || null;
  const r = run("INSERT INTO offer_checks (domain, role, token) VALUES (?, ?, ?)", domain, role, randomBytes(12).toString("base64url"));
  return Number(r.lastInsertRowid);
}

/** Keep only the fields Offer Check reads (job descriptions alone can be megabytes). */
function trim(source: Source, body: unknown): unknown {
  if (source === "enrich" || !isObj(body) || !Array.isArray(body.data)) return body;
  const keep: Record<Exclude<Source, "enrich">, string[]> = {
    financing: ["effective_date", "found_at", "financing_type", "financing_type_normalized", "amount", "amount_normalized"],
    jobs: ["title", "first_seen_at", "last_seen_at", "categories"],
    news: ["category", "headline", "found_at", "effective_date", "job_title"],
  };
  return {
    meta: body.meta,
    data: body.data.filter(isObj).map((r) => {
      const a = isObj(r.attributes) ? r.attributes : r;
      return { attributes: Object.fromEntries(keep[source].filter((k) => k in a).map((k) => [k, a[k]])) };
    }),
  };
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

async function fetchSource(source: Source, domain: string, maxCredits: number, now: number): Promise<unknown> {
  const d = encodeURIComponent(domain);
  if (source === "enrich") {
    return coldiq("/v1/company/enrich", { body: { input: { domain }, max_credits: Math.floor(maxCredits * 100) / 100, soft_miss: true } });
  }
  const path = {
    financing: `/v1/predictleads/companies/${d}/financing_events`,
    jobs: `/v1/predictleads/companies/${d}/job_openings?limit=1000&last_seen_at_from=${ymd(now - 200 * DAY)}`,
    news: `/v1/predictleads/companies/${d}/news_events?limit=1000&found_at_from=${ymd(now - 400 * DAY)}`,
  }[source];
  return coldiq(path);
}

/** Raw data for a domain: from a check made in the last 7 days, or fresh from ColdIQ. */
async function gather(check: OfferCheck, now: number): Promise<{ raw: RawSources; sources: Record<Source, SourceState>; spent: number; cached: boolean; fetchedAt: string }> {
  const since = new Date(now - CACHE_DAYS * DAY).toISOString();
  const cached = get<OfferCheck>(
    "SELECT * FROM offer_checks WHERE domain = ? AND raw IS NOT NULL AND fetched_at >= ? ORDER BY fetched_at DESC LIMIT 1",
    check.domain, since,
  );
  if (cached) return { raw: json(cached.raw, {}), sources: json(cached.sources, {} as Record<Source, SourceState>), spent: 0, cached: true, fetchedAt: cached.fetched_at! };

  const cap = getSettings().offerCheckCreditCap;
  return withRun(async () => {
    const raw: RawSources = {};
    const sources = {} as Record<Source, SourceState>;
    const spentSoFar = () =>
      get<{ n: number | null }>("SELECT SUM(credits) AS n FROM credit_ledger WHERE run_id = ?", currentRunId() ?? "")?.n ?? 0;
    for (const source of SOURCES) {
      const left = Math.min(allowance().credits, cap - spentSoFar());
      if (left < PRICE[source]) {
        sources[source] = "skipped";
        continue;
      }
      try {
        const body = await fetchSource(source, check.domain, left, now);
        const miss = isObj(body) && body.found === false;
        sources[source] = miss ? "missing" : "ok";
        if (!miss) raw[source] = trim(source, body);
      } catch (e) {
        if (e instanceof ColdiqError && (e.status === 401 || e.status === 402)) throw e;
        if (e instanceof CreditCapError) {
          sources[source] = "skipped";
          continue;
        }
        sources[source] = "missing";
        if (!(e instanceof ColdiqError && e.status === 404)) {
          logEvent({ source: "offer-check", kind: source, ok: false, note: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return { raw, sources, spent: spentSoFar(), cached: false, fetchedAt: new Date(now).toISOString() };
  });
}

export async function runOfferCheck(id: number, opts: { now?: Date } = {}): Promise<{ check: OfferView; cached: boolean; spent: number }> {
  const check = getOfferCheck(id);
  if (!check) throw new Error("Check not found.");
  const now = opts.now ?? new Date();
  const s = getSettings();
  try {
    const g = await gather(check, now.getTime());
    const facts = buildFacts({
      domain: check.domain, role: check.role, now, raw: g.raw, sources: g.sources,
      costPerHead: { low: s.costPerHeadLow, high: s.costPerHeadHigh },
    });
    const result = scoreFacts(facts);
    updateOfferCheck(id, {
      status: "scored", sources: JSON.stringify(g.sources), raw: JSON.stringify(g.raw), facts: JSON.stringify(facts),
      result: JSON.stringify(result), credits: check.credits + g.spent, error: null,
      // A cached copy keeps its original fetch time, so re-reading it never extends the 7 days.
      fetched_at: g.fetchedAt,
    });
    if (config.museApiKey()) {
      try {
        const analysis = await explainOffer({ facts, score: result, checkId: id });
        updateOfferCheck(id, { status: "done", analysis: JSON.stringify(analysis) });
      } catch (e) {
        updateOfferCheck(id, { error: `The explanation failed: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    return { check: viewOf(getOfferCheck(id)!), cached: g.cached, spent: g.spent };
  } catch (e) {
    updateOfferCheck(id, { status: check.facts ? check.status : "failed", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
