import { randomBytes } from "node:crypto";
import {
  all, getStudy, logEvent, lookalikes, run, seeds, updateCompany, updateStudy, type Company, type Study,
} from "./db";
import { assertColdiq, assertMuse } from "./config";
import { toImportRows } from "./csv";
import { isLens, mergeProfile, runLens, type Lens } from "./enrich";
import { CreditCapError, allowance, withRun } from "./credits";
import { computeStats, type Subject } from "./features";
import { analyze, type Analysis } from "./agents";
import { coldiq } from "./coldiq";
import { candidates, scoreCandidate, searchFilters } from "./lookalike";
import { getSettings } from "./settings";
import type { TraitStat } from "./features";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export type StoredAnalysis = Analysis & { refs: Record<string, TraitStat> };

// ---------- create ------------------------------------------------------

export const MAX_COMPANIES = 500;

export function createStudy(input: { name: string; notes: string; lenses: string[]; csv: string }) {
  const { rows, skipped, customColumns } = toImportRows(input.csv);
  if (!rows.length) throw new Error("No usable rows. Each row needs a domain or website.");
  if (rows.length > MAX_COMPANIES) throw new Error(`Up to ${MAX_COMPANIES} companies per study. This file has ${rows.length}.`);
  const lenses = input.lenses.filter(isLens);
  const token = randomBytes(12).toString("base64url");
  const res = run(
    "INSERT INTO studies (name, token, lenses, notes, custom_columns) VALUES (?, ?, ?, ?, ?)",
    input.name.trim() || "Untitled study", token, JSON.stringify(lenses), input.notes.trim(), JSON.stringify(customColumns),
  );
  const id = Number(res.lastInsertRowid);
  for (const r of rows) {
    run(
      `INSERT INTO companies (study_id, kind, domain, name, label, deal_value, custom, status)
       VALUES (?, 'seed', ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      id, r.domain, r.name, r.label, r.dealValue, JSON.stringify(r.custom), lenses.length ? "pending" : "enriched",
    );
  }
  updateStudy(id, { status: lenses.length ? "draft" : "ready" });
  return { id, imported: rows.length, skipped, customColumns, winners: rows.filter((r) => r.label === "winner").length };
}

export function deleteStudy(id: number) {
  run("DELETE FROM companies WHERE study_id = ?", id);
  run("DELETE FROM studies WHERE id = ?", id);
}

// ---------- enrich (resumable, capped) -----------------------------------

const running = new Set<number>();

/**
 * Runs every selected lens for every company that hasn't had it yet. Stops cleanly when a
 * credit cap is reached (study becomes "paused"); calling it again continues where it stopped.
 */
export async function enrichStudy(studyId: number): Promise<{ done: number; paused: string | null }> {
  if (running.has(studyId)) return { done: 0, paused: null };
  running.add(studyId);
  try {
    return await withRun(async () => {
      assertColdiq();
      const study = getStudy(studyId);
      if (!study) throw new Error("Study not found");
      const lenses = parseJson<Lens[]>(study.lenses, []);
      updateStudy(studyId, { status: "enriching", error: null });
      let done = 0;
      const pending = all<Company>("SELECT * FROM companies WHERE study_id = ? AND kind = 'seed' AND status = 'pending' ORDER BY id", studyId);
      for (const c of pending) {
        const finished = new Set(parseJson<Lens[]>(c.lenses_done, []));
        let profile = c.profile;
        try {
          for (const lens of lenses) {
            if (finished.has(lens)) continue;
            try {
              profile = JSON.stringify(mergeProfile(profile, await runLens({ ...c, profile }, lens)));
            } catch (e) {
              if (e instanceof CreditCapError && e.cap === "company") {
                logEvent({ source: "credits", kind: "company_cap", ok: false, note: `${c.domain}: skipped ${lens}` });
              } else throw e;
            }
            finished.add(lens);
            updateCompany(c.id, { profile, lenses_done: JSON.stringify([...finished]) });
          }
          updateCompany(c.id, { status: "enriched", error: null });
          done++;
        } catch (e) {
          if (e instanceof CreditCapError) {
            updateStudy(studyId, { status: "paused", error: e.message });
            return { done, paused: e.message };
          }
          updateCompany(c.id, { status: "failed", error: errMsg(e) });
          // A bad key or an empty balance fails every company the same way: stop instead.
          if (/API key|out of credits/i.test(errMsg(e))) {
            updateStudy(studyId, { status: "paused", error: errMsg(e) });
            return { done, paused: errMsg(e) };
          }
        }
      }
      updateStudy(studyId, { status: "ready", error: null });
      return { done, paused: null };
    });
  } finally {
    running.delete(studyId);
  }
}

/** Studies the background job keeps enriching. */
export async function enrichActiveStudies() {
  const ids = all<{ id: number }>("SELECT id FROM studies WHERE status = 'enriching'");
  for (const { id } of ids) await enrichStudy(id);
  return ids.length;
}

export function retryFailed(studyId: number) {
  run("UPDATE companies SET status = 'pending', error = NULL WHERE study_id = ? AND kind = 'seed' AND status = 'failed'", studyId);
}

// ---------- analyze -----------------------------------------------------

export function subjectsOf(studyId: number): Subject[] {
  return seeds(studyId)
    .filter((c) => c.status === "enriched" || c.status === "failed" || c.status === "pending")
    .map((c) => ({
      label: c.label,
      profile: parseJson(c.profile, {}),
      custom: parseJson<Record<string, string>>(c.custom, {}),
      dealValue: c.deal_value,
    }));
}

export function studyStats(studyId: number) {
  return computeStats(subjectsOf(studyId), getSettings().minSupport);
}

export async function analyzeStudy(studyId: number): Promise<StoredAnalysis> {
  assertMuse();
  const study = getStudy(studyId);
  if (!study) throw new Error("Study not found");
  const stats = studyStats(studyId);
  if (stats.winners < 3) throw new Error("Add at least 3 winners before analysing.");
  if (!stats.traits.length) {
    throw new Error("No trait is shared by enough companies yet. Enrich the companies or lower 'minimum support' in Settings.");
  }
  const analysis = await analyze({ stats, offer: getSettings().offer, notes: study.notes, studyId });
  updateStudy(studyId, { analysis: JSON.stringify(analysis), status: "analyzed", error: null });
  rescoreLookalikes(studyId);
  return analysis;
}

// ---------- lookalikes --------------------------------------------------

export async function findLookalikes(studyId: number): Promise<{ found: number; scored: number }> {
  assertColdiq();
  const study = getStudy(studyId);
  const analysis = parseJson<StoredAnalysis | null>(study?.analysis, null);
  if (!study || !analysis) throw new Error("Run the analysis first.");
  return withRun(async () => {
    const s = getSettings();
    // Best winners first: highest deal value, then the ones matching the most must-have traits.
    const winners = seeds(studyId).filter((c) => c.label === "winner");
    const seedDomains = [...winners].sort((a, b) => (b.deal_value ?? 0) - (a.deal_value ?? 0)).map((c) => c.domain);
    const exclude = seeds(studyId).map((c) => c.domain);
    const filters = { ...searchFilters(analysis, seedDomains, s.lookalikeLimit), exclude_domains: exclude.slice(0, 300) };
    const a = allowance();
    if (a.credits <= 0) throw new CreditCapError(a.cap);
    const body = await coldiq("/v1/companies/search", {
      studyId,
      body: { input: filters, max_credits: Math.floor(a.credits * 100) / 100, soft_miss: true },
    });
    updateStudy(studyId, { lookalike_filters: JSON.stringify(filters) });
    const found = candidates((body as { data?: unknown }).data ?? body).filter((c) => !exclude.includes(c.domain));
    let scored = 0;
    for (const c of found) {
      const { score, why } = scoreCandidate(c.profile, analysis, analysis.refs);
      run(
        `INSERT INTO companies (study_id, kind, domain, name, profile, status, score, why)
         VALUES (?, 'lookalike', ?, ?, ?, 'enriched', ?, ?)
         ON CONFLICT(study_id, kind, domain) DO UPDATE SET profile = excluded.profile, score = excluded.score, why = excluded.why`,
        studyId, c.domain, c.name, JSON.stringify(c.profile), score, why,
      );
      if (score !== null) scored++;
    }
    return { found: found.length, scored };
  });
}

/** Re-score saved lookalikes after a new analysis (free: no ColdIQ calls). */
export function rescoreLookalikes(studyId: number) {
  const analysis = parseJson<StoredAnalysis | null>(getStudy(studyId)?.analysis, null);
  if (!analysis) return 0;
  const list = lookalikes(studyId);
  for (const c of list) {
    const { score, why } = scoreCandidate(parseJson(c.profile, {}), analysis, analysis.refs);
    updateCompany(c.id, { score, why });
  }
  return list.length;
}

export type { Study };
