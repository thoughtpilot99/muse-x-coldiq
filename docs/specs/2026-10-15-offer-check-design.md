# Offer Check: design

Date: 2026-10-15. Status: draft for review.

## Goal

A second tool inside ICP Detective (same repo, same app). A job seeker enters a company website and, optionally, the role they were offered. About a minute later they get a health report on the company:

- a score from 0 to 100,
- four risk areas, each green, amber, red or unknown, with dated evidence,
- a plain-language verdict and questions to ask in the interview, written by Muse Wonder,
- a shareable link and an image card for X and LinkedIn.

Success: a check on a real company costs at most 15 ColdIQ credits (about $0.21), every number in the report is computed in code and every number in the AI text is checked against it.

Not in version 1: alerts, comparing several offers, accounts, payments, website-change tracking (ColdIQ returned "not found" for it in testing).

## Data (ColdIQ, verified live on 2026-10-15)

| Call | Cost | Used for |
|---|---|---|
| `POST /v1/company/enrich` | about 3.5 | headcount, `employee_growth_rate`, funding rounds (fallback), industry |
| `GET /v1/predictleads/companies/{domain}/financing_events` | 2.51 flat | rounds: `effective_date`, `financing_type`, `amount_normalized` |
| `GET /v1/predictleads/companies/{domain}/job_openings?limit=1000` | 2.51 flat | `first_seen_at`, `last_seen_at`, `categories`, `title` |
| `GET /v1/predictleads/companies/{domain}/news_events?found_at_from=<12 months ago>` | 2.51 flat | `category`, `effective_date`/`found_at`, `job_title`, `headline` |

Total about 11 credits. Each call goes through the existing client (`lib/coldiq.ts`) and credit governor (`lib/credits.ts`) with `max_credits`. Results are cached per domain for 7 days, so repeating a check is free. A 404 from one source means "unknown" for that area, not failure.

## Facts (pure code, `lib/offer/facts.ts`)

From the raw responses, code builds one `Facts` object. Nothing else is shown or sent to the model.

- **Funding:** last round date, type, amount; months since; total raised in the last 36 months. Runway estimate = last round amount / (headcount x monthly cost per head) - months since the round, shown as a range (cost per head $10k-15k per month, editable in Settings). Labelled "rough estimate".
- **Hiring:** open now = roles last seen in the 14 days before the check. Open 90 days ago = roles first seen on or before that day and last seen on or after it. New roles in the last 90 days vs the 90 days before. If a role was entered, the number of open roles that match its department (same department table as `lib/profile.ts`).
- **Team:** headcount and 12-month growth %.
- **News, last 12 months:** counts and dated items for warning categories (`decreases_headcount_by`, `closes_offices_in`, `has_issues_with`, `files_suit_against`, `sells_assets_to`, `merges_with`), leadership departures (`leaves` or `retires_from` where the job title is C-level, VP, Head of or Founder) and positive categories (`receives_financing`, `increases_headcount_by`, `expands_offices_in`, `expands_offices_to`, `launches`, `signs_new_client`).

Privacy: people are shown by role only ("a VP Engineering left in June 2025"), never by name. Names in the raw data never reach the report or the model.

## Score (pure code, `lib/offer/score.ts`)

| Area | Weight | Green | Amber | Red |
|---|---|---|---|---|
| Funding | 30 | round in last 18 months and runway estimate 12+ months | 18-30 months, or runway 6-12 | over 30 months with no new round, or runway under 6 |
| Hiring | 30 | open now at least 80% of 90 days ago | 40-80% | under 40%, or no open roles confirmed |
| Team | 20 | growth 0% or more | -10% to 0% | under -10% |
| News | 20 | no warning items | 1 warning or 1 leadership departure | layoffs or office closures, or 2+ warnings |

No data in an area means "unknown", which is left out of the score, never counted as bad. Score = weighted average of known areas (green 100, amber 50, red 0). Coverage = share of weight that was known. Under 50% coverage the report says "not enough data" instead of a score. No funding found is reported as "no venture funding found; the company may be bootstrapped or public", unknown, not red.

## AI (Muse Wonder, `lib/offer/agent.ts`)

Input: the facts and the area results as a numbered table, the role if given. Output (structured): headline verdict, what looks good, what worries us, 5 questions to ask in the interview, caveats. Same grounding rules as the ICP analysis: every number in the text must match the table, one retry, then "not verified" labels. The model is told not to predict layoffs or failure, only to explain the evidence.

## Pages

- `/offer-check`: form (website, optional role) and a list of past checks with score and cost.
- `/offer-check/[id]`: full report, evidence lists, cost, "Refresh" (uses the cache unless older than 7 days), "Share".
- `/o/[token]`: public page outside APP_PASSWORD, noindex, strict CSP, 16-character token. Same content minus raw evidence links.
- `/o/[token]/opengraph-image`: 1200x630 card: company domain, score, four coloured areas, "checked with ICP Detective".
- Nav gets "Offer Check". Home page shows the latest checks.

Every report carries: "Not financial or career advice. Based on public data that can be incomplete or late."

## Storage

New table `offer_checks(id, domain, role, token, status, facts, result, analysis, credits, created_at, fetched_at)`. Raw responses go to Events as today.

## Tests

- facts from trimmed real fixtures (linear.app responses from 2026-10-15),
- hiring trend and runway maths, unknown handling,
- score thresholds and the "not enough data" rule,
- names never appear in facts, report or model input,
- grounding retry and "not verified" labels,
- credit cap stops a check, cache makes a repeat check free.

## Docs

README: a new "Offer Check" section (problem, how it works, how the score is computed, costs, limits). Root README line updated.
