import { all, run } from "./db";

export type Settings = {
  /** What you sell, so the analysis knows which traits matter. */
  offer: string;
  /** Credit governor (ColdIQ credits). */
  runCreditCap: number;
  dailyCreditCap: number;
  perCompanyCreditCap: number;
  /** Lookalike search size. */
  lookalikeLimit: number;
  /** A trait needs at least this many winners before it can be part of the ICP. */
  minSupport: number;
  /** Offer Check: credits one check may spend. */
  offerCheckCreditCap: number;
};

export const DEFAULT_SETTINGS: Settings = {
  offer: "",
  runCreditCap: 40,
  dailyCreditCap: 80,
  perCompanyCreditCap: 10,
  lookalikeLimit: 25,
  minSupport: 3,
  offerCheckCreditCap: 15,
};

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in s)) continue;
    const k = key as keyof Settings;
    (s as Record<string, unknown>)[k] = typeof DEFAULT_SETTINGS[k] === "number" ? Number(value) : value;
  }
  return s;
}

export function saveSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, String(value),
    );
  }
}
