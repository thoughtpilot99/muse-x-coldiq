import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/muse", async (orig) => ({ ...(await orig<typeof import("@/lib/muse")>()), runStructured: vi.fn() }));

import { runStructured } from "@/lib/muse";
import { all, db, getStudy, lookalikes, seeds } from "@/lib/db";
import { coldiq, creditsCharged } from "@/lib/coldiq";
import { spentOnStudy } from "@/lib/credits";
import { analyzeStudy, createStudy, enrichStudy, findLookalikes, parseJson, type StoredAnalysis } from "@/lib/pipeline";
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { reportHtml } from "@/lib/report";

const json = (body: unknown, credits = 0, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "x-coldiq-credits-charged": String(credits) } });

const CSV = [
  "domain,name,label,deal_value",
  "northwind.example,Northwind,winner,24000",
  "contoso.example,Contoso,winner,18000",
  "adatum.example,Adatum,winner,9000",
  "fabrikam.example,Fabrikam,loser,3000",
  "litware.example,Litware,loser,2000",
].join("\n");

const PROFILES: Record<string, unknown> = {
  "northwind.example": { name: "Northwind", industry: "Retail", employees: 120, technologies: ["Shopify"] },
  "contoso.example": { name: "Contoso", industry: "Retail", employees: 90, technologies: ["Shopify", "Klaviyo"] },
  "adatum.example": { name: "Adatum", industry: "Retail", employees: 60, technologies: ["Shopify"] },
  "fabrikam.example": { name: "Fabrikam", industry: "Software", employees: 15, technologies: ["Magento"] },
  "litware.example": { name: "Litware", industry: "Software", employees: 8, technologies: ["WooCommerce"] },
};

function coldiqMock() {
  return vi.fn(async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (url.endsWith("/v1/company/enrich")) return json({ data: PROFILES[body.input.domain], _meta: { provider: "test" } }, 1);
    if (url.endsWith("/v1/companies/search")) {
      return json({ data: { companies: [
        { domain: "tailspin.example", name: "Tailspin", industry: "Retail", employees: 110, technologies: ["Shopify"] },
        { domain: "wingtip.example", name: "Wingtip", industry: "Software", employees: 12, technologies: ["Magento"] },
        { domain: "northwind.example", name: "Northwind" }, // already a customer: excluded
      ] } }, 2);
    }
    return json({ error: "unexpected" }, 0, 500);
  });
}

beforeEach(() => {
  db().exec("DELETE FROM companies; DELETE FROM studies; DELETE FROM credit_ledger; DELETE FROM events; DELETE FROM settings;");
  vi.mocked(runStructured).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ColdIQ client", () => {
  it("reads credits from the header, _meta or bulk results", () => {
    expect(creditsCharged(new Headers({ "x-coldiq-credits-charged": "1.5" }), {})).toBe(1.5);
    expect(creditsCharged(new Headers(), { _meta: { credits_charged: 2 } })).toBe(2);
    expect(creditsCharged(new Headers(), { results: [{ _meta: { credits_charged: 1 } }, { _meta: { credits_charged: 0.5 } }] })).toBe(1.5);
  });

  it("sends a bearer key, retries 429 and records the charge", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(json({ data: { ok: true } }, 3));
    vi.stubGlobal("fetch", fetchMock);
    await coldiq("/v1/company/enrich", { body: { input: { domain: "a.example" } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.coldiq.com/v1/company/enrich");
    expect(init.headers.Authorization).toBe("Bearer test-coldiq");
    expect(all<{ credits: number }>("SELECT credits FROM credit_ledger")).toEqual([{ credits: 3 }]);
  });

  it("explains a rejected key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "bad" }, 0, 401)));
    await expect(coldiq("/v1/me/credits", { free: true })).rejects.toThrow(/rejected the API key/);
  });
});

describe("study pipeline", () => {
  it("analyses CSV-only studies without spending credits", () => {
    const r = createStudy({ name: "CSV only", notes: "", lenses: [], csv: "domain,plan\na.example,Pro\nb.example,Pro\nc.example,Pro" });
    expect(getStudy(r.id)!.status).toBe("ready");
    expect(seeds(r.id).every((c) => c.status === "enriched")).toBe(true);
  });

  it("stops at the run cap, then resumes where it stopped", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, runCreditCap: 2 });
    const fetchMock = coldiqMock();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = createStudy({ name: "Q4", notes: "", lenses: ["firmographics"], csv: CSV });

    const first = await enrichStudy(id);
    expect(first.done).toBe(2);
    expect(first.paused).toMatch(/run's ColdIQ credit cap/);
    expect(getStudy(id)!.status).toBe("paused");
    // Every call was capped at what was left: 2, then 1.
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).max_credits)).toEqual([2, 1]);

    saveSettings({ runCreditCap: 40 });
    const second = await enrichStudy(id);
    expect(second).toEqual({ done: 3, paused: null });
    expect(getStudy(id)!.status).toBe("ready");
    expect(spentOnStudy(id)).toBe(5);
    expect(parseJson(seeds(id).find((c) => c.domain === "northwind.example")!.profile, {})).toMatchObject({ industry: "Retail", employees: 120 });
  });

  it("writes a verified ICP, finds lookalikes and keeps customer names out of the report", async () => {
    saveSettings({ minSupport: 2 });
    vi.stubGlobal("fetch", coldiqMock());
    const { id } = createStudy({ name: "Q4", notes: "", lenses: ["firmographics"], csv: CSV });
    await enrichStudy(id);

    vi.mocked(runStructured).mockImplementation(async ({ user }) => {
      const ref = (label: string) => String(user).split("\n").find((l) => l.includes(label))!.split(" | ")[0];
      return {
        headline: "Shopify retailers are your best customers: 3/3 winners vs 0/2 losers.",
        icp_summary: "Retail brands on Shopify with 51-200 people.",
        must_have: [{ trait_id: ref("Uses Shopify"), why: "3/3 winners use Shopify, 0/2 losers do." }],
        nice_to_have: [],
        anti_icp: [{ trait_id: ref("Industry | Software"), why: "Both losers are software companies." }],
        surprises: [],
        caveats: ["Only 5 companies."],
        search: { keywords: [], industries: ["Retail"], technologies: ["Shopify"], countries: [], min_employees: 50, max_employees: 250 },
      };
    });
    const a = await analyzeStudy(id);
    expect(a.unverified).toEqual([]);
    expect(runStructured).toHaveBeenCalledTimes(1);

    const r = await findLookalikes(id);
    expect(r.found).toBe(2);
    const looks = lookalikes(id);
    expect(looks.map((c) => [c.domain, c.score])).toEqual([["tailspin.example", 100], ["wingtip.example", 0]]);
    expect(looks[1].why).toMatch(/Warning: Industry: Software|Warning: Software/);

    const html = reportHtml(getStudy(id)!, parseJson<StoredAnalysis>(getStudy(id)!.analysis, null as never));
    expect(html).toContain("Shopify retailers are your best customers");
    for (const name of ["northwind", "contoso", "fabrikam", "Northwind"]) expect(html).not.toContain(name);
  });

  it("retries once when the model invents a number, then flags it", async () => {
    vi.stubGlobal("fetch", coldiqMock());
    const { id } = createStudy({ name: "Q4", notes: "", lenses: ["firmographics"], csv: CSV });
    await enrichStudy(id);
    vi.mocked(runStructured).mockResolvedValue({
      headline: "9/10 winners use Shopify.", icp_summary: "x", must_have: [], nice_to_have: [], anti_icp: [], surprises: [],
      caveats: [], search: { keywords: [], industries: [], technologies: [], countries: [], min_employees: null, max_employees: null },
    });
    const a = await analyzeStudy(id);
    expect(runStructured).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(runStructured).mock.calls[1][0].user)).toContain("9/10 winners use Shopify.");
    expect(a.unverified).toEqual(["9/10 winners use Shopify."]);
  });
});
