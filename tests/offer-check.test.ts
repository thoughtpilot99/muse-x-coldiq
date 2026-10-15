import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/muse", async (orig) => ({ ...(await orig<typeof import("@/lib/muse")>()), runStructured: vi.fn() }));

import { runStructured } from "@/lib/muse";
import { all, db, getOfferCheck } from "@/lib/db";
import { createOfferCheck, runOfferCheck } from "@/lib/offer/check";
import { offerReportHtml } from "@/lib/offer/report";
import { saveSettings } from "@/lib/settings";
import financing from "./fixtures/linear-financing.json";
import jobs from "./fixtures/linear-jobs.json";
import news from "./fixtures/linear-news.json";

const NOW = new Date("2026-10-15T12:00:00Z");
const ENRICH = { data: { company: { name: "Linear", employees: { employee_count: 180, employee_growth_rate: 12 } } }, _meta: { provider: "limadata" } };

const reply = (body: unknown, credits: number, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "x-coldiq-credits-charged": String(credits) } });

function coldiqMock(over: Partial<Record<"enrich" | "financing" | "jobs" | "news", () => Response>> = {}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/v1/company/enrich")) return over.enrich?.() ?? reply(ENRICH, 3.5);
    if (url.includes("/financing_events")) return over.financing?.() ?? reply(financing, 2.5116);
    if (url.includes("/job_openings")) return over.jobs?.() ?? reply(jobs, 2.5116);
    if (url.includes("/news_events")) return over.news?.() ?? reply(news, 2.5116);
    return reply({ error: "unexpected" }, 0, 500);
  });
}

const ANSWER = {
  verdict: "Linear looks healthy: 39 open roles now vs 31 90 days ago.",
  good: ["Raised a Series C 16 months ago."],
  worries: [],
  questions: ["What is the runway after the Series C?", "Is the Sales team growing?", "What changed this year?", "How is the team measured?", "What are the plans for next year?"],
  caveats: ["Public data can be late."],
};

beforeEach(() => {
  db().exec("DELETE FROM offer_checks; DELETE FROM credit_ledger; DELETE FROM events; DELETE FROM settings;");
  vi.mocked(runStructured).mockReset().mockResolvedValue(ANSWER);
});
afterEach(() => vi.unstubAllGlobals());

describe("offer check pipeline", () => {
  it("normalizes the website and rejects junk", () => {
    const id = createOfferCheck({ website: "https://www.Linear.app/careers", role: " Account Executive " });
    expect(getOfferCheck(id)).toMatchObject({ domain: "linear.app", role: "Account Executive" });
    expect(() => createOfferCheck({ website: "not a site" })).toThrow(/company website/);
  });

  it("makes four calls, records the credits and stores facts, score and explanation", async () => {
    const fetchMock = coldiqMock();
    vi.stubGlobal("fetch", fetchMock);
    const id = createOfferCheck({ website: "linear.app", role: "Account Executive" });
    const r = await runOfferCheck(id, { now: NOW });

    const urls = fetchMock.mock.calls.map(([u]) => String(u).replace("https://api.coldiq.com", ""));
    expect(urls[0]).toBe("/v1/company/enrich");
    expect(urls[1]).toBe("/v1/predictleads/companies/linear.app/financing_events");
    expect(urls[2]).toBe("/v1/predictleads/companies/linear.app/job_openings?limit=1000&last_seen_at_from=2026-03-29");
    expect(urls[3]).toBe("/v1/predictleads/companies/linear.app/news_events?limit=1000&found_at_from=2025-09-10");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).max_credits).toBe(15);

    expect(r.spent).toBeCloseTo(3.5 + 3 * 2.5116);
    expect(r.check.status).toBe("done");
    expect(r.check.credits).toBeCloseTo(11.03, 1);
    expect(r.check.resultData?.score).toBe(100);
    expect(r.check.factsData?.hiring.roleOpenNow).toBe(6);
    expect(r.check.analysisData?.unverified).toEqual([]);
  });

  it("reuses a check from the last 7 days without calling ColdIQ", async () => {
    vi.stubGlobal("fetch", coldiqMock());
    await runOfferCheck(createOfferCheck({ website: "linear.app" }), { now: NOW });
    const fetchMock = coldiqMock();
    vi.stubGlobal("fetch", fetchMock);
    const second = await runOfferCheck(createOfferCheck({ website: "www.linear.app" }), { now: new Date(NOW.getTime() + 3 * 86_400_000) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(second).toMatchObject({ cached: true, spent: 0 });
    expect(second.check.fetched_at).toBe(NOW.toISOString());

    await runOfferCheck(createOfferCheck({ website: "linear.app" }), { now: new Date(NOW.getTime() + 8 * 86_400_000) });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("marks a source that ColdIQ can't find as unknown", async () => {
    vi.stubGlobal("fetch", coldiqMock({ jobs: () => reply({ error: "Not found" }, 0, 404), news: () => reply({ error: "Not found" }, 0, 404) }));
    const r = await runOfferCheck(createOfferCheck({ website: "linear.app" }), { now: NOW });
    expect(r.check.factsData?.sources).toEqual({ enrich: "ok", financing: "ok", jobs: "missing", news: "missing" });
    expect(r.check.resultData?.areas.map((a) => a.level)).toEqual(["green", "unknown", "green", "unknown"]);
    expect(r.check.resultData?.score).toBe(100);
  });

  it("skips calls the check's credit cap can't cover", async () => {
    saveSettings({ offerCheckCreditCap: 6 });
    const fetchMock = coldiqMock();
    vi.stubGlobal("fetch", fetchMock);
    const r = await runOfferCheck(createOfferCheck({ website: "linear.app" }), { now: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.check.factsData?.sources).toEqual({ enrich: "ok", financing: "skipped", jobs: "skipped", news: "skipped" });
    expect(r.check.resultData?.score).toBeNull();
  });

  it("stops on a rejected key or empty balance", async () => {
    vi.stubGlobal("fetch", coldiqMock({ enrich: () => reply({ error: "no credits" }, 0, 402) }));
    const id = createOfferCheck({ website: "linear.app" });
    await expect(runOfferCheck(id, { now: NOW })).rejects.toThrow(/out of credits/);
    expect(getOfferCheck(id)?.status).toBe("failed");
  });

  it("keeps facts and score when the explanation fails", async () => {
    vi.stubGlobal("fetch", coldiqMock());
    vi.mocked(runStructured).mockReset().mockRejectedValue(new Error("model down"));
    const r = await runOfferCheck(createOfferCheck({ website: "linear.app" }), { now: NOW });
    expect(r.check.status).toBe("scored");
    expect(r.check.resultData?.score).toBe(100);
    expect(r.check.error).toMatch(/model down/);
  });

  it("builds a public report with no names, no raw data and the disclaimer", async () => {
    const withNames = { data: [...news.data, { attributes: { category: "leaves", headline: "Jane Doe leaves Linear after serving as Chief Financial Officer", effective_date: "2026-08-01" } }] };
    vi.stubGlobal("fetch", coldiqMock({ news: () => reply(withNames, 2.5) }));
    const r = await runOfferCheck(createOfferCheck({ website: "linear.app" }), { now: NOW });
    const html = offerReportHtml(r.check, "https://example.test");
    expect(html).toContain("linear.app");
    expect(html).toContain("A Chief Financial Officer left");
    expect(html).toContain("Not financial or career advice");
    expect(html).toContain(`https://example.test/o/${r.check.token}/card`);
    for (const s of ["Jane", "Doe", "Naomi", "Cristina", "techstartups.com"]) expect(html).not.toContain(s);
    expect(all("SELECT * FROM offer_checks")).toHaveLength(1);
  });
});
