import { config } from "./config";
import { logEvent } from "./db";
import { enrichActiveStudies } from "./pipeline";

const g = globalThis as unknown as { __idJobs?: boolean; __idRunning?: boolean };

async function tick() {
  if (g.__idRunning || !config.coldiqApiKey()) return;
  g.__idRunning = true;
  try {
    await enrichActiveStudies();
  } catch (e) {
    logEvent({ source: "jobs", kind: "enrich", ok: false, note: e instanceof Error ? e.message : String(e) });
  } finally {
    g.__idRunning = false;
  }
}

/** Keeps enriching studies in the background, so large lists don't depend on a browser tab. */
export function startJobs() {
  if (g.__idJobs || !config.jobsEnabled()) return;
  g.__idJobs = true;
  setInterval(() => void tick(), 60_000).unref?.();
}
