import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/muse", async (orig) => ({ ...(await orig<typeof import("@/lib/muse")>()), runStructured: vi.fn() }));

import { runStructured } from "@/lib/muse";
import { explainOffer, factTable, ungroundedSentences } from "@/lib/offer/agent";
import { buildFacts, type Facts, type RawSources, type Source, type SourceState } from "@/lib/offer/facts";
import { scoreFacts } from "@/lib/offer/score";
import financing from "./fixtures/linear-financing.json";
import jobs from "./fixtures/linear-jobs.json";
import news from "./fixtures/linear-news.json";

// Fixtures are trimmed live ColdIQ (PredictLeads) responses for linear.app from 2026-10-15.
export const NOW = new Date("2026-10-15T12:00:00Z");
export const ENRICH = {
  data: { company: { name: "Linear", domain: "linear.app", employees: { employee_count: 180, employee_growth_rate: 12 }, categories: { industry: "Software Development" } } },
};
const ALL_OK: Record<Source, SourceState> = { enrich: "ok", financing: "ok", jobs: "ok", news: "ok" };

const facts = (over: { raw?: RawSources; sources?: Partial<Record<Source, SourceState>>; role?: string } = {}) =>
  buildFacts({
    domain: "linear.app",
    role: over.role ?? null,
    now: NOW,
    raw: { enrich: ENRICH, financing, jobs, news, ...over.raw },
    sources: { ...ALL_OK, ...over.sources },
  });

describe("offer facts", () => {
  it("reads funding, hiring and team from real responses", () => {
    const f = facts({ role: "Account Executive" });
    expect(f.company).toEqual({ name: "Linear", industry: "Software Development", headcount: 180, growthPct: 12 });
    expect(f.funding.last).toEqual({ date: "2025-06-10", type: "Series C", amountUsd: 82_000_000 });
    expect(f.funding.monthsSince).toBe(16);
    expect(f.hiring).toMatchObject({ known: true, openNow: 39, open90DaysAgo: 31, newLast90: 22, newPrior90: 21, roleDepartment: "Sales", roleOpenNow: 6 });
  });

  it("only counts news from the last 12 months, by role and never by name", () => {
    const f = facts({
      raw: {
        news: {
          data: [
            ...news.data,
            { attributes: { category: "leaves", headline: "Jane Doe leaves Linear after serving as Chief Financial Officer", effective_date: "2026-08-01", contact: "Jane Doe" } },
            { attributes: { category: "leaves", headline: "Sam Roe leaves Linear", job_title: "Designer", effective_date: "2026-08-02" } },
            { attributes: { category: "decreases_headcount_by", headline: "Linear cuts 10%", found_at: "2026-07-01T00:00:00Z" } },
          ],
        },
      },
    });
    // The VP Engineering departure in the fixture is from June 2025: older than 12 months.
    expect(f.news.departures).toEqual([{ date: "2026-08-01", category: "leaves", label: "A Chief Financial Officer left" }]);
    expect(f.news.warnings.map((w) => w.category)).toEqual(["decreases_headcount_by"]);
    const text = JSON.stringify(f);
    for (const name of ["Naomi", "Sato", "Jane", "Doe", "Sam Roe", "Cristina"]) expect(text).not.toContain(name);
  });

  it("treats missing sources as unknown, not as zero", () => {
    const f = facts({ sources: { jobs: "missing", news: "missing", financing: "missing" }, raw: { enrich: { data: { company: { name: "Acme" } } } } });
    expect(f.hiring.known).toBe(false);
    expect(f.news.known).toBe(false);
    expect(f.funding.last).toBeNull();
    const r = scoreFacts(f);
    expect(r.areas.map((a) => a.level)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(r.score).toBeNull();
  });

  it("dates rounds by the event and falls back to when it was found", () => {
    const f = facts({ raw: { financing: { data: [{ attributes: { found_at: "2026-09-01T10:00:00Z", financing_type: "Series D", amount_normalized: 150_000_000 } }, ...financing.data] } } });
    expect(f.funding.last).toEqual({ date: "2026-09-01", type: "Series D", amountUsd: 150_000_000 });
    expect(f.funding.monthsSince).toBe(1);
    expect(f.funding.raised36mUsd).toBe(232_000_000);
  });

  it("skips the role line when the role matches no department", () => {
    expect(facts({ role: "Chef" }).hiring).toMatchObject({ roleDepartment: null, roleOpenNow: null });
  });
});

const withChanges = (f: Facts, change: (f: Facts) => void) => {
  const copy = structuredClone(f);
  change(copy);
  return copy;
};

describe("offer score", () => {
  const base = facts();

  it("scores linear.app from its real data", () => {
    const r = scoreFacts(base);
    expect(r.areas.map((a) => [a.key, a.level])).toEqual([["funding", "green"], ["hiring", "green"], ["team", "green"], ["news", "green"]]);
    expect(r.score).toBe(100);
    expect(r.coverage).toBe(1);
  });

  it("applies the funding thresholds and the late-stage cap", () => {
    const at = (months: number, headcount = 180) =>
      scoreFacts(withChanges(base, (f) => { f.funding.monthsSince = months; f.company.headcount = headcount; })).areas[0].level;
    expect(at(18)).toBe("green");
    expect(at(19)).toBe("amber");
    expect(at(30)).toBe("amber");
    expect(at(31)).toBe("red");
    expect(at(31, 5000)).toBe("amber");
  });

  it("applies the hiring, team and news thresholds", () => {
    const hiring = (now: number, before: number, noneConfirmed = false) =>
      scoreFacts(withChanges(base, (f) => Object.assign(f.hiring, { openNow: now, open90DaysAgo: before, noneConfirmed }))).areas[1].level;
    expect(hiring(8, 10)).toBe("green");
    expect(hiring(4, 10)).toBe("amber");
    expect(hiring(3, 10)).toBe("red");
    expect(hiring(0, 0, true)).toBe("red");
    expect(hiring(0, 0)).toBe("amber");

    const team = (g: number) => scoreFacts(withChanges(base, (f) => { f.company.growthPct = g; })).areas[2].level;
    expect([team(0), team(-10), team(-11)]).toEqual(["green", "amber", "red"]);

    const item = (category: string, day = 1) => ({ date: `2026-08-${String(day).padStart(2, "0")}`, category, label: category });
    const newsArea = (w: string[], d = 0) =>
      scoreFacts(withChanges(base, (f) => { f.news.warnings = w.map((c, i) => item(c, i + 1)); f.news.departures = Array.from({ length: d }, () => item("leaves")); })).areas[3];
    expect(newsArea(["merges_with"]).level).toBe("amber");
    expect(newsArea([], 1).level).toBe("amber");
    expect(newsArea(["merges_with"], 1).level).toBe("amber");
    expect(newsArea([], 2).level).toBe("red");
    expect(newsArea(["decreases_headcount_by"]).level).toBe("red");
    expect(newsArea(["closes_offices_in"]).level).toBe("red");
  });

  it("counts many incidents of one kind once (vercel.com had 29 security reports)", () => {
    const a = scoreFacts(withChanges(base, (f) => {
      f.news.warnings = Array.from({ length: 29 }, (_, i) => ({ date: `2026-0${(i % 9) + 1}-10`, category: "has_issues_with", label: "Security, product or legal incident reported" }));
    })).areas[3];
    expect(a.level).toBe("amber");
    expect(a.reason).toBe("In the last 12 months: Security, product or legal incident reported (29, latest 2026-09-10).");
  });

  it("leaves unknown areas out and needs half the weight to give a score", () => {
    const r = scoreFacts(withChanges(base, (f) => { f.hiring.known = false; f.news.known = false; f.company.growthPct = -20; }));
    expect(r.coverage).toBe(0.5);
    expect(r.score).toBe(Math.round((30 * 100 + 20 * 0) / 50));
    const thin = scoreFacts(withChanges(base, (f) => { f.hiring.known = false; f.news.known = false; f.funding.last = null; f.funding.monthsSince = null; }));
    expect(thin.score).toBeNull();
  });
});

describe("offer explanation", () => {
  beforeEach(() => vi.mocked(runStructured).mockReset());
  const f = facts({ role: "Account Executive" });
  const s = scoreFacts(f);
  const answer = (verdict: string) => ({ verdict, good: ["39 open roles now vs 31 90 days ago."], worries: [], questions: ["What is the runway after the Series C?"], caveats: [] });

  it("gives the model numbered facts with every number and no names", () => {
    const table = factTable(f, s);
    expect(table).toContain("F1 | Company | Linear, Software Development");
    expect(table).toContain("last round: Series C, $82M, 2025-06-10, 16 months ago");
    expect(table).toContain("open Sales roles now (the candidate's department): 6");
    expect(table).toContain("100/100");
    expect(table).not.toMatch(/Naomi|Cristina/);
  });

  it("accepts numbers from the facts and flags invented ones", () => {
    const table = factTable(f, s);
    expect(ungroundedSentences(["Linear raised $82M 16 months ago. It has 39 open roles."], table)).toEqual([]);
    expect(ungroundedSentences(["Headcount grew 12% last year.", "Revenue is $40M."], table)).toEqual(["Revenue is $40M."]);
  });

  it("retries once, then marks what is still not in the facts", async () => {
    vi.mocked(runStructured)
      .mockResolvedValueOnce(answer("Linear has 200 open roles."))
      .mockResolvedValueOnce(answer("Linear is hiring fast, with 39 open roles."));
    const a = await explainOffer({ facts: f, score: s, checkId: 1 });
    expect(runStructured).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(runStructured).mock.calls[1][0].user)).toContain("Linear has 200 open roles.");
    expect(a.unverified).toEqual([]);

    vi.mocked(runStructured).mockReset().mockResolvedValue(answer("Runway is 40 months."));
    expect((await explainOffer({ facts: f, score: s, checkId: 1 })).unverified).toEqual(["Runway is 40 months."]);
  });
});
