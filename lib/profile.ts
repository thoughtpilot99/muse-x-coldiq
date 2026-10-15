// ColdIQ normalizes provider responses, but the exact field names of each record are not
// documented, so values are looked up by a list of likely names anywhere in the record.

export type Profile = {
  name?: string;
  industry?: string;
  employees?: number;
  revenueUsd?: number;
  country?: string;
  foundedYear?: number;
  fundingStage?: string;
  totalFundingUsd?: number;
  technologies?: string[];
  description?: string;
  hiring?: { total: number; departments: Record<string, number> };
  ads?: { count: number; platforms: string[] };
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Breadth-first: lowercase key -> first non-empty value, searched up to depth 4. */
export function flatten(record: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  let level: unknown[] = [record];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (!isObj(node)) continue;
      for (const [k, v] of Object.entries(node)) {
        const key = k.toLowerCase();
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
        if (!out.has(key)) out.set(key, v);
        if (isObj(v)) next.push(v);
      }
    }
    level = next;
  }
  return out;
}

const pick = (m: Map<string, unknown>, keys: string[]) => keys.map((k) => m.get(k)).find((v) => v !== undefined);

const str = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v) && v.length) return str(v[0]);
  if (isObj(v)) return str(v.name ?? v.label ?? v.value);
  return undefined;
};

/** "1,200" -> 1200, "$12.5M" -> 12500000, "51-200" -> 125, "10K+" -> 10000. */
export function parseAmount(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : undefined;
  if (isObj(v)) return parseAmount(v.value ?? v.amount ?? v.min ?? v.estimate);
  if (typeof v !== "string") return undefined;
  const unit = (s: string) => (/b/i.test(s) ? 1e9 : /m/i.test(s) ? 1e6 : /k/i.test(s) ? 1e3 : 1);
  const nums = [...v.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([kmb])?/gi)].map((m) => Number(m[1]) * unit(m[2] ?? ""));
  if (!nums.length) return undefined;
  const n = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
  return n > 0 ? Math.round(n) : undefined;
}

const year = (v: unknown) => {
  const n = Number(String(v ?? "").match(/\b(1[89]\d\d|20\d\d)\b/)?.[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function stringList(v: unknown): string[] {
  if (typeof v === "string") return v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  // Some providers group the stack by category: { CRM: ["Hubspot"], Analytics: ["Looker"] }.
  if (isObj(v)) return [...new Set(Object.values(v).flatMap(stringList))];
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x): x is string => !!x);
}

/** Values that only exist inside lists: the HQ office, the latest funding round. */
function fromLists(m: Map<string, unknown>) {
  const list = (keys: string[]) => (pick(m, keys) as unknown[] | undefined)?.filter(isObj) ?? [];
  const offices = list(["locations", "offices", "addresses"]);
  const hq = offices.find((o) => o.is_hq === true || o.is_primary === true || o.headquarters === true) ?? offices[0];
  const rounds = list(["funding_rounds", "rounds", "funding_events"])
    .sort((a, b) => String(b.date ?? b.announced_on ?? "").localeCompare(String(a.date ?? a.announced_on ?? "")));
  return {
    country: str(hq?.country ?? hq?.country_code),
    fundingStage: str(rounds[0]?.type ?? rounds[0]?.funding_type ?? rounds[0]?.round_type),
  };
}

export function firmographics(record: unknown): Profile {
  const m = flatten(record);
  const lists = fromLists(m);
  const p: Profile = {
    name: str(pick(m, ["name", "company_name", "organization_name", "legal_name"])),
    industry: str(pick(m, ["industry", "primary_industry", "linkedin_industry", "industries", "sector", "category"])),
    employees: parseAmount(pick(m, ["employee_count", "employees", "headcount", "num_employees", "estimated_num_employees", "employees_count", "company_size", "size", "employee_range", "employees_range"])),
    revenueUsd: parseAmount(pick(m, ["annual_revenue", "revenue", "estimated_revenue", "revenue_usd", "revenue_range", "estimated_annual_revenue"])),
    country: str(pick(m, ["hq_country", "headquarters_country", "country", "country_name", "country_code"])) ?? lists.country,
    foundedYear: year(pick(m, ["founded_year", "year_founded", "founded", "founding_year"])),
    fundingStage: str(pick(m, ["funding_stage", "last_funding_type", "latest_funding_stage", "last_funding_round_type", "latest_funding_type", "last_round_type"])) ?? lists.fundingStage,
    totalFundingUsd: parseAmount(pick(m, ["total_funding", "total_funding_usd", "funding_total", "total_funding_amount", "total_raised"])),
    technologies: stringList(pick(m, ["technologies", "tech_stack", "technology_names", "techs", "technology", "current_technologies"])).slice(0, 60),
    description: str(pick(m, ["short_description", "description", "summary", "about", "seo_description"]))?.slice(0, 600),
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as Profile;
}

/** The first array of objects in a response that looks like a list of records with the given fields. */
export function records(body: unknown, anyOf: string[]): Json[] {
  let level: unknown[] = [body];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) {
        const objs = node.filter(isObj);
        if (objs.length && objs.some((o) => anyOf.some((k) => k in o))) return objs;
        next.push(...objs);
      } else if (isObj(node)) next.push(...Object.values(node));
    }
    level = next;
  }
  return [];
}

export const DEPARTMENTS: [string, RegExp][] = [
  ["Sales", /\b(sales|account executive|sdr|bdr|business development|account manager|revenue)\b/i],
  ["Marketing", /\b(marketing|growth|seo|content|brand|demand gen|communications|social media|paid media)\b/i],
  ["Engineering", /\b(engineer|engineering|developer|devops|software|front[- ]?end|back[- ]?end|full[- ]?stack|sre|architect)\b/i],
  ["Product & design", /\b(product manager|product owner|designer|ux|ui designer|product design)\b/i],
  ["Data & AI", /\b(data|analyst|analytics|machine learning|ml|ai|scientist)\b/i],
  ["Customer success", /\b(customer success|support|customer service|onboarding|implementation|account management)\b/i],
  ["Operations", /\b(operations|ops|logistics|supply chain|warehouse|procurement|fulfil?ment)\b/i],
  ["Finance", /\b(finance|accountant|accounting|controller|fp&a|payroll|bookkeep)\b/i],
  ["People", /\b(recruit|recruiter|talent|hr|people partner|human resources)\b/i],
];

export function hiring(body: unknown): Profile["hiring"] {
  const jobs = records(body, ["title", "job_title", "position"]);
  const departments: Record<string, number> = {};
  for (const j of jobs) {
    const title = str(j.title ?? j.job_title ?? j.position) ?? "";
    for (const [dept, re] of DEPARTMENTS) {
      if (re.test(title)) {
        departments[dept] = (departments[dept] ?? 0) + 1;
        break;
      }
    }
  }
  return { total: jobs.length, departments };
}

export function ads(body: unknown, fallbackPlatform?: string | null): Profile["ads"] {
  const list = records(body, ["ad_id", "id", "body", "text", "headline", "title", "creative", "advertiser", "page_name"]);
  const platforms = new Set<string>();
  for (const a of list) {
    const p = str(a.platform ?? a.source ?? a.network)?.toLowerCase();
    if (p) platforms.add(p.includes("facebook") || p.includes("instagram") ? "meta" : p);
  }
  if (list.length && !platforms.size && fallbackPlatform) platforms.add(fallbackPlatform.toLowerCase());
  return { count: list.length, platforms: [...platforms] };
}
