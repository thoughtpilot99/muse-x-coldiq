# Offer Check: build plan

Spec: [2026-10-15-offer-check-design.md](2026-10-15-offer-check-design.md). Built in this session, task by task, tests first.

## Files

| File | Responsibility |
|---|---|
| `lib/offer/facts.ts` | Pure: raw ColdIQ responses -> `Facts` (funding, hiring, team, news). No names. |
| `lib/offer/score.ts` | Pure: `Facts` -> four `AreaResult`s, score, coverage. |
| `lib/offer/agent.ts` | Fact table for Muse, `OfferAnalysisSchema`, number grounding, `explainOffer()`. |
| `lib/offer/check.ts` | Fetch with credit limits and 7-day cache, store, `runOfferCheck()`. |
| `lib/offer/report.ts` | Self-contained HTML for the public page. |
| `lib/db.ts` | `offer_checks` table and helpers. |
| `lib/settings.ts` | `costPerHeadLow` 10000, `costPerHeadHigh` 15000, `offerCheckCreditCap` 15. |
| `app/offer-check/page.tsx`, `app/offer-check/[id]/page.tsx`, `app/offer-actions.ts` | UI. |
| `app/o/[token]/route.ts`, `app/o/[token]/card/route.tsx` | Public report and 1200x630 card. |
| `proxy.ts`, `app/layout.tsx`, `app/page.tsx`, `app/settings/page.tsx` | Public path, nav, home list, settings fields. |
| `tests/offer.test.ts`, `tests/fixtures/linear-*.json` | Tests on trimmed real responses. |

## Tasks

1. **Facts.** Trimmed fixtures from the live linear.app calls. Tests: last round Series C $82M 2025-06-10; months since; runway range; secondary rounds excluded from runway; hiring open now vs 90 days ago and new-role windows; role department match; growth %; news warnings and leadership departures within 12 months by role only; no person name anywhere in `JSON.stringify(facts)`.
2. **Score.** Tests: each threshold edge; unknown areas excluded; coverage under 50% gives `score: null`; no funding found is unknown with the bootstrapped note; companies with 1,000+ people cap funding at amber (long gaps are normal for profitable late-stage companies).
3. **Agent.** Tests: fact table lists every number; a sentence with a number not in the table is flagged; one retry with feedback; still wrong -> `unverified`.
4. **Check pipeline + storage.** Tests with mocked fetch: four calls in order, credits recorded, 404 on one source -> that area unknown; repeat within 7 days makes zero calls; check cap stops calls (`max_credits` and skip when less than a call's price is left).
5. **Pages, public report, card, nav, settings.** Smoke test via build and a local request to each page.
6. **Docs.** README section, root README line, `.env.example` unchanged. Then lint, `next typegen`, `tsc`, tests, build.
7. **Live test** on 1-2 public companies (about 25 credits), check the Events page, fix field mapping if needed.

## Review focus

- A domain with a path or `www.` -> normalized before lookup and caching.
- A company with no jobs data at all -> hiring unknown, not red.
- News rows dated more than 12 months ago -> ignored even if found recently.
- A role that matches no department -> role line omitted, no crash.
- Muse key missing -> facts and score still shown; verdict section says to connect Muse.
