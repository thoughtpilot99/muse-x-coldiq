import { config, assertColdiq } from "./config";
import { logEvent } from "./db";
import { recordCall } from "./credits";

// ColdIQ Unified API (https://api.coldiq.com/docs): one key, 40+ data providers.
// Paid "GTM verb" endpoints run a provider waterfall, charge only on success and
// accept max_credits per lookup. The charge is reported in X-ColdIQ-Credits-Charged
// and in _meta.credits_charged.

export class ColdiqError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** Credits charged by one response: header first, then _meta, then the sum over bulk results. */
export function creditsCharged(headers: Headers, body: unknown): number {
  const h = Number(headers.get("x-coldiq-credits-charged"));
  if (headers.has("x-coldiq-credits-charged") && Number.isFinite(h)) return h;
  const b = obj(body);
  const meta = Number(obj(b._meta).credits_charged);
  if (Number.isFinite(meta)) return meta;
  if (Array.isArray(b.results)) {
    return b.results.reduce((n: number, r) => n + (Number(obj(obj(r)._meta).credits_charged) || 0), 0);
  }
  return 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function coldiq<T = Json>(
  path: string,
  opts: { method?: "GET" | "POST"; body?: Json; studyId?: number | null; companyId?: number | null; attempts?: number; free?: boolean } = {},
): Promise<T> {
  assertColdiq();
  const method = opts.method ?? (opts.body ? "POST" : "GET");
  const attempts = opts.attempts ?? 3;
  for (let i = 1; ; i++) {
    const res = await fetch(`${config.coldiqApiUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.coldiqApiKey()}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 2000) };
    }
    if (res.status === 429 && i < attempts) {
      const wait = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) * 1000 : 2000 * i);
      continue;
    }
    const credits = creditsCharged(res.headers, body);
    const provider = String(obj(obj(body)._meta).provider_name ?? obj(obj(body)._meta).provider ?? "") || null;
    // Free reads (balance) aren't logged; every other call is, with its raw payload, so the
    // field mapping can be checked against real data.
    if (!opts.free || credits) {
      recordCall({ endpoint: path, credits, provider, studyId: opts.studyId, companyId: opts.companyId, ok: res.ok });
      logEvent({ source: "coldiq", kind: `${method} ${path}`, ok: res.ok, note: `${res.status}, ${credits} credit(s)`, payload: text.slice(0, 8_000) });
    }
    if (!res.ok) {
      const b = obj(body);
      const msg = String(b.error ?? b.message ?? text.slice(0, 200) ?? res.statusText);
      if (res.status === 401) throw new ColdiqError(401, "ColdIQ rejected the API key. Check it on the Setup page.");
      if (res.status === 402) throw new ColdiqError(402, "Your ColdIQ account is out of credits.");
      throw new ColdiqError(res.status, `ColdIQ ${path} returned ${res.status}: ${msg}`);
    }
    return body as T;
  }
}

export type CreditBalance = { balance: number; usedThisMonth: number; usd_per_credit: number; billing_scope?: string };

/** Free call: balance, month-to-date usage and the price of one credit. */
export async function getBalance(): Promise<CreditBalance> {
  return coldiq<CreditBalance>("/v1/me/credits", { free: true });
}
