"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MissingKeysError } from "@/lib/config";
import { CreditCapError } from "@/lib/credits";
import {
  analyzeStudy, createStudy, deleteStudy, enrichStudy, findLookalikes, retryFailed,
} from "@/lib/pipeline";
import { getStudy, updateStudy } from "@/lib/db";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";

export type ActionResult = { ok: boolean; message: string };

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    revalidatePath("/", "layout");
    if (e instanceof MissingKeysError) {
      return { ok: false, message: `Connect these on the Setup page first: ${e.missing.map((m) => m.label).join(", ")}` };
    }
    if (e instanceof CreditCapError) return { ok: false, message: e.message };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const idOf = (fd: FormData) => z.coerce.number().int().positive().parse(fd.get("id"));
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function createStudyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = 0;
  const result = await attempt(async () => {
    const file = fd.get("file");
    const csv = file instanceof File && file.size ? await file.text() : str(fd, "csv");
    if (!csv.trim()) throw new Error("Upload a CSV or paste one.");
    if (csv.length > 2_000_000) throw new Error("That file is too large (2 MB max).");
    const r = createStudy({ name: str(fd, "name"), notes: str(fd, "notes"), lenses: fd.getAll("lenses").map(String), csv });
    id = r.id;
    return "Created.";
  });
  if (result.ok) redirect(`/studies/${id}`);
  return result;
}

export async function enrichAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = idOf(fd);
    if (fd.get("intent") === "retry") retryFailed(id);
    const r = await enrichStudy(id);
    return r.paused ? `Enriched ${r.done} compan${r.done === 1 ? "y" : "ies"}. ${r.paused}` : `Enriched ${r.done} compan${r.done === 1 ? "y" : "ies"}. Ready to analyse.`;
  });
}

export async function skipEnrichAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    updateStudy(idOf(fd), { status: "ready", error: null });
    return "Skipped the remaining enrichment. The analysis will use the data you already have.";
  });
}

export async function analyzeAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const a = await analyzeStudy(idOf(fd));
    return a.unverified.length
      ? `Done. ${a.unverified.length} statement(s) could not be matched to the data and are flagged in the report.`
      : "Done. Every count in the analysis matches the data.";
  });
}

export async function lookalikesAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const r = await findLookalikes(idOf(fd));
    return `Found ${r.found} lookalike compan${r.found === 1 ? "y" : "ies"}, ${r.scored} scored against your ICP.`;
  });
}

export async function deleteStudyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = idOf(fd);
  if (str(fd, "confirm") !== getStudy(id)?.name) return { ok: false, message: "Type the study name to confirm." };
  deleteStudy(id);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function saveSettingsAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const patch: Partial<Settings> = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      const v = fd.get(key);
      if (v === null) continue;
      if (typeof def === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a positive number`);
        (patch as Record<string, unknown>)[key] = n;
      } else {
        (patch as Record<string, unknown>)[key] = String(v).trim();
      }
    }
    if (patch.lookalikeLimit !== undefined && (patch.lookalikeLimit < 1 || patch.lookalikeLimit > 100)) {
      throw new Error("Lookalike limit must be between 1 and 100");
    }
    saveSettings(patch);
    return "Settings saved.";
  });
}
