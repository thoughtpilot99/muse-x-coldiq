import { DEPARTMENTS, firmographics, flatten, parseAmount } from "../profile";

// Offer Check turns raw ColdIQ responses into plain facts. Everything shown in the report or
// sent to Muse Wonder comes from here, so this is also where privacy is enforced: people are
// described by their role only, and raw headlines (which name people) never leave this file.

export type Source = "enrich" | "financing" | "jobs" | "news";
export type SourceState = "ok" | "missing" | "skipped";

export type Round = { date: string | null; type: string; amountUsd: number | null };
export type NewsItem = { date: string; category: string; label: string };

export type Facts = {
  domain: string;
  role: string | null;
  checkedAt: string;
  sources: Record<Source, SourceState>;
  company: { name?: string; industry?: string; headcount?: number; growthPct?: number };
  funding: {
    rounds: Round[];
    last: Round | null;
    monthsSince: number | null;
    raised36mUsd: number | null;
    /** Months of runway left, as a rough range; null when amount, date or headcount is unknown. */
    runway: { low: number; high: number } | null;
  };
  hiring: {
    known: boolean;
    openNow: number;
    open90DaysAgo: number;
    newLast90: number;
    newPrior90: number;
    noneConfirmed: boolean;
    roleDepartment: string | null;
    roleOpenNow: number | null;
  };
  news: { known: boolean; warnings: NewsItem[]; departures: NewsItem[]; positives: NewsItem[] };
};

export type RawSources = Partial<Record<Source, unknown>>;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const DAY = 86_400_000;

/** PredictLeads-style rows: { data: [{ attributes: {...} }] } or a plain array. */
function rows(body: unknown): Json[] {
  const d = isObj(body) ? (body.data ?? body) : body;
  const list = Array.isArray(d) ? d : isObj(d) && Array.isArray(d.data) ? d.data : [];
  return list.filter(isObj).map((r) => (isObj(r.attributes) ? r.attributes : r));
}

const time = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
export const monthsBetween = (from: number, to: number) => Math.max(0, Math.floor((to - from) / (30.44 * DAY)));

const SECONDARY = /secondary|tender|debt|grant|ipo|post[-_ ]?ipo|acquisition/i;

function fundingRounds(financing: unknown, enrich: unknown): Round[] {
  const fromEvents = rows(financing).map((r) => ({
    date: (() => {
      const t = time(r.effective_date) ?? time(r.found_at);
      return t === null ? null : day(t);
    })(),
    type: String(r.financing_type ?? r.financing_type_normalized ?? "Funding round"),
    amountUsd: parseAmount(r.amount_normalized ?? r.amount) ?? null,
  }));
  const list = fromEvents.length
    ? fromEvents
    : ((flatten(enrich).get("funding_rounds") as unknown[] | undefined) ?? []).filter(isObj).map((r) => ({
        date: (() => {
          const t = time(r.date ?? r.announced_on);
          return t === null ? null : day(t);
        })(),
        type: String(r.type ?? r.funding_type ?? "Funding round"),
        amountUsd: parseAmount(r.amount ?? r.money_raised) ?? null,
      }));
  return list.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

const LEADER = /\b(chief [a-z]+ officer|c[etofmrp]o|vp(?: of)? [a-z]+|vice president(?: of)? [a-z]+|head of [a-z]+|co-?founder|founder|president|general manager)\b/i;

const WARNINGS: Record<string, string> = {
  decreases_headcount_by: "Headcount reduction reported",
  closes_offices_in: "Office closure reported",
  has_issues_with: "Reported issues or disputes",
  files_suit_against: "Legal dispute reported",
  sells_assets_to: "Sold assets",
  merges_with: "Merger reported",
};
const POSITIVES: Record<string, string> = {
  receives_financing: "Raised funding",
  increases_headcount_by: "Headcount increase reported",
  expands_offices_in: "Office expansion",
  expands_offices_to: "Expanded to a new location",
  opens_new_location: "Opened a new location",
  launches: "Product launch",
  signs_new_client: "New client announced",
};
export const SEVERE = new Set(["decreases_headcount_by", "closes_offices_in"]);

export function buildFacts(input: {
  domain: string;
  role?: string | null;
  now: Date;
  raw: RawSources;
  sources: Record<Source, SourceState>;
  costPerHead: { low: number; high: number };
}): Facts {
  const now = input.now.getTime();
  const { raw, sources } = input;

  // Company
  const firm = sources.enrich === "ok" ? firmographics(raw.enrich) : {};
  const growth = Number(flatten(raw.enrich).get("employee_growth_rate"));
  const company = {
    name: firm.name,
    industry: firm.industry,
    headcount: firm.employees,
    growthPct: sources.enrich === "ok" && Number.isFinite(growth) ? growth : undefined,
  };

  // Funding
  const rounds = fundingRounds(sources.financing === "ok" ? raw.financing : null, sources.enrich === "ok" ? raw.enrich : null);
  const last = rounds.find((r) => r.date) ?? null;
  const lastTime = last?.date ? Date.parse(last.date) : null;
  const monthsSince = lastTime === null ? null : monthsBetween(lastTime, now);
  const recent = rounds.filter((r) => r.date && now - Date.parse(r.date) <= 36 * 30.44 * DAY && r.amountUsd);
  const cash = rounds.find((r) => r.date && r.amountUsd && !SECONDARY.test(r.type));
  let runway: Facts["funding"]["runway"] = null;
  if (cash?.amountUsd && cash.date && company.headcount) {
    const since = monthsBetween(Date.parse(cash.date), now);
    const total = (cost: number) => cash.amountUsd! / (company.headcount! * cost);
    runway = { low: Math.max(0, Math.floor(total(input.costPerHead.high) - since)), high: Math.max(0, Math.floor(total(input.costPerHead.low) - since)) };
  }

  // Hiring
  const jobs = sources.jobs === "ok" ? rows(raw.jobs) : [];
  const meta = isObj(raw.jobs) && isObj(raw.jobs.meta) ? raw.jobs.meta : {};
  const noneConfirmed = meta.no_active_openings_confirmed === true;
  const at90 = now - 90 * DAY;
  const at180 = now - 180 * DAY;
  let openNow = 0, open90DaysAgo = 0, newLast90 = 0, newPrior90 = 0;
  const openTitles: string[] = [];
  for (const j of jobs) {
    const first = time(j.first_seen_at);
    const lastSeen = time(j.last_seen_at) ?? first;
    if (first === null || lastSeen === null) continue;
    if (lastSeen >= now - 14 * DAY) {
      openNow++;
      openTitles.push(String(j.title ?? ""));
    }
    if (first <= at90 && lastSeen >= at90) open90DaysAgo++;
    if (first > at90 && first <= now) newLast90++;
    else if (first > at180 && first <= at90) newPrior90++;
  }
  const dept = input.role ? DEPARTMENTS.find(([, re]) => re.test(input.role!)) : undefined;

  // News, last 12 months only, dated by the event (not when it was found)
  const news = { known: sources.news === "ok" && rows(raw.news).length > 0, warnings: [] as NewsItem[], departures: [] as NewsItem[], positives: [] as NewsItem[] };
  for (const n of sources.news === "ok" ? rows(raw.news) : []) {
    const t = time(n.effective_date) ?? time(n.found_at);
    if (t === null || t > now || now - t > 365 * DAY) continue;
    const category = String(n.category ?? "");
    const date = day(t);
    if (WARNINGS[category]) news.warnings.push({ date, category, label: WARNINGS[category] });
    else if (POSITIVES[category]) news.positives.push({ date, category, label: POSITIVES[category] });
    else if (category === "leaves" || category === "retires_from") {
      const role = String(n.job_title ?? "").match(LEADER)?.[0] ?? String(n.headline ?? "").match(LEADER)?.[0];
      if (role) news.departures.push({ date, category, label: `A ${role.replace(/^./, (c) => c.toUpperCase())} left` });
    }
  }
  for (const list of [news.warnings, news.departures, news.positives]) list.sort((a, b) => b.date.localeCompare(a.date));

  return {
    domain: input.domain,
    role: input.role?.trim() || null,
    checkedAt: input.now.toISOString(),
    sources,
    company: Object.fromEntries(Object.entries(company).filter(([, v]) => v !== undefined)) as Facts["company"],
    funding: {
      rounds,
      last,
      monthsSince,
      raised36mUsd: recent.length ? recent.reduce((s, r) => s + (r.amountUsd ?? 0), 0) : null,
      runway,
    },
    hiring: {
      known: sources.jobs === "ok" && (jobs.length > 0 || noneConfirmed),
      openNow, open90DaysAgo, newLast90, newPrior90, noneConfirmed,
      roleDepartment: dept?.[0] ?? null,
      roleOpenNow: dept ? openTitles.filter((t) => dept[1].test(t)).length : null,
    },
    news,
  };
}
