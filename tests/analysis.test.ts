import { describe, expect, it } from "vitest";
import { normalizeDomain, parseLabel, toImportRows } from "@/lib/csv";
import { ageBand, computeStats, headcountBand, normalizeStage, traitsOf, type Subject } from "@/lib/features";
import { firmographics, hiring, parseAmount } from "@/lib/profile";
import { keepKnownRefs, traitTable, unverifiedClaims, type ModelAnalysis } from "@/lib/agents";

describe("csv import", () => {
  it("maps columns, labels and custom traits, skipping bad rows", () => {
    const csv = [
      "Website;Company;Outcome;ARR;Plan",
      "https://www.Northwind.example/;Northwind;won;24,000;Pro",
      "contoso.example;Contoso;customer;€18000;Pro",
      "fabrikam.example;Fabrikam;churned;3000;Starter",
      "not a domain;Bad;won;1;Pro",
      "contoso.example;Contoso again;won;1;Pro",
      "litware.example;Litware;maybe;1;Pro",
    ].join("\n");
    const r = toImportRows(csv);
    expect(r.customColumns).toEqual(["Plan"]);
    expect(r.rows.map((x) => [x.domain, x.label, x.dealValue])).toEqual([
      ["northwind.example", "winner", 24000],
      ["contoso.example", "winner", 18000],
      ["fabrikam.example", "loser", 3000],
    ]);
    expect(r.rows[0].custom).toEqual({ Plan: "Pro" });
    expect(r.skipped).toEqual(["not a domain", "litware.example"]);
  });

  it("requires a domain column and reads quoted commas", () => {
    expect(() => toImportRows("name,label\nA,won")).toThrow(/domain or website/);
    const r = toImportRows('domain,name\nacme.example,"Acme, Inc."');
    expect(r.rows[0]).toMatchObject({ domain: "acme.example", name: "Acme, Inc.", label: "winner" });
  });

  it("normalizes domains and labels", () => {
    expect(normalizeDomain("HTTPS://www.Acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(parseLabel("Lost")).toBe("loser");
    expect(parseLabel(undefined)).toBe("winner");
    expect(parseLabel("unsure")).toBeNull();
  });
});

describe("profile extraction", () => {
  it("finds firmographics under unknown field names", () => {
    const p = firmographics({
      company: { name: "Northwind", industry: "Retail", employee_range: "51-200", hq: { country: "US" } },
      funding: { last_funding_type: "series_b", total_funding: "$12.5M" },
      technologies: [{ name: "Shopify" }, "Klaviyo"],
      founded_year: 2016,
    });
    expect(p).toMatchObject({
      name: "Northwind", industry: "Retail", employees: 126, country: "US",
      fundingStage: "series_b", totalFundingUsd: 12_500_000, technologies: ["Shopify", "Klaviyo"], foundedYear: 2016,
    });
  });

  it("parses amounts and groups job titles by department", () => {
    expect(parseAmount("1,200")).toBe(1200);
    expect(parseAmount("10K+")).toBe(10000);
    expect(parseAmount("n/a")).toBeUndefined();
    const h = hiring({ data: { jobs: [{ title: "Account Executive" }, { title: "Senior Backend Engineer" }, { title: "SDR" }] } });
    expect(h).toEqual({ total: 3, departments: { Sales: 2, Engineering: 1 } });
  });
});

const subj = (label: "winner" | "loser", over: Partial<Subject["profile"]>, custom: Record<string, string> = {}): Subject =>
  ({ label, profile: over, custom });

describe("traits and stats", () => {
  it("buckets numbers into readable bands", () => {
    expect(headcountBand(8)).toBe("1-10");
    expect(headcountBand(150)).toBe("51-200");
    expect(headcountBand(9000)).toBe("5,000+");
    expect(ageBand(2024, 2026)).toBe("0-3 years old");
    expect(normalizeStage("series_c")).toBe("Series C+");
    expect(normalizeStage("SEED")).toBe("Seed");
  });

  it("computes winner vs loser shares only over companies with known data", () => {
    const subjects = [
      subj("winner", { technologies: ["Shopify"] }),
      subj("winner", { technologies: ["Shopify", "Klaviyo"] }),
      subj("winner", { technologies: ["Shopify"] }),
      subj("winner", {}), // no tech data: must not count as "doesn't use Shopify"
      subj("loser", { technologies: ["WooCommerce"] }),
      subj("loser", { technologies: ["Shopify"] }),
      subj("loser", { technologies: ["Magento"] }),
    ];
    const stats = computeStats(subjects, 1);
    const shopify = stats.traits.find((t) => t.label === "Uses Shopify")!;
    expect(shopify).toMatchObject({ winners: 3, winnersKnown: 3, losers: 1, losersKnown: 3 });
    expect(shopify.lift).toBeCloseTo((4 / 5) / (2 / 5));
    expect(stats.traits[0].label).toBe("Uses Shopify");
    expect(stats.coverage["Tech stack"]).toBeCloseTo(6 / 7);
  });

  it("drops traits below minimum support and analyses custom columns", () => {
    const subjects = [
      subj("winner", {}, { Plan: "Pro" }), subj("winner", {}, { Plan: "Pro" }), subj("winner", {}, { Plan: "Starter" }),
    ];
    const stats = computeStats(subjects, 2);
    expect(stats.traits.map((t) => t.label)).toEqual(["Plan: Pro"]);
    expect(stats.traits[0].loserShare).toBeNull();
    expect(traitsOf(subjects[0])[0]).toMatchObject({ group: "Plan", id: "plan:plan-pro" });
  });
});

describe("grounding", () => {
  const stats = computeStats([
    subj("winner", { industry: "Retail" }), subj("winner", { industry: "Retail" }), subj("winner", { industry: "Retail" }),
    subj("winner", { industry: "SaaS" }), subj("loser", { industry: "SaaS" }), subj("loser", { industry: "SaaS" }),
  ], 1);

  it("accepts counts from the table and flags invented ones", () => {
    expect(unverifiedClaims(["3/4 winners are retailers, versus 0 of 2 losers.", "That is 75% of winners."], stats)).toEqual([]);
    expect(unverifiedClaims(["9/10 winners are retailers.", "Retail is fine."], stats)).toEqual(["9/10 winners are retailers."]);
    expect(unverifiedClaims(["Nearly 90% of winners are retailers."], stats)).toHaveLength(1);
  });

  it("drops references to traits that are not in the table", () => {
    const { byRef } = traitTable(stats);
    const a = { must_have: [{ trait_id: "t1", why: "x" }, { trait_id: "T99", why: "made up" }], nice_to_have: [], anti_icp: [], surprises: [] } as unknown as ModelAnalysis;
    const r = keepKnownRefs(a, byRef);
    expect(r.analysis.must_have).toEqual([{ trait_id: "T1", why: "x" }]);
    expect(r.dropped).toEqual(["T99: made up"]);
  });
});
