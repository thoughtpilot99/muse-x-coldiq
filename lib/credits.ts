import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { get, run } from "./db";
import { getSettings } from "./settings";

// Every ColdIQ call is written to credit_ledger with the credits ColdIQ says it charged.
// Before a paid call, the remaining allowance (daily, per run, per company) is checked, so a
// study can never spend more than the caps set in Settings.

export class CreditCapError extends Error {
  constructor(public cap: "daily" | "run" | "company") {
    super(
      cap === "daily"
        ? "Paused: today's ColdIQ credit cap is reached. Raise it in Settings or continue tomorrow."
        : cap === "run"
          ? "Paused: this run's ColdIQ credit cap is reached. Press Continue to spend another run's worth."
          : "Skipped: this company hit the per-company credit cap.",
    );
  }
}

const runs = new AsyncLocalStorage<{ id: string }>();

/** Everything inside fn shares one run budget. */
export function withRun<T>(fn: () => Promise<T>): Promise<T> {
  return runs.run({ id: randomUUID() }, fn);
}

export const currentRunId = () => runs.getStore()?.id ?? null;

const sum = (sql: string, ...p: (string | number)[]) => get<{ n: number | null }>(sql, ...p)?.n ?? 0;

export function spentToday(): number {
  return sum("SELECT SUM(credits) AS n FROM credit_ledger WHERE date(created_at, 'localtime') = date('now', 'localtime')");
}

export function spentOnStudy(studyId: number): number {
  return sum("SELECT SUM(credits) AS n FROM credit_ledger WHERE study_id = ?", studyId);
}

/** Credits that may still be spent right now, and which cap is the tightest. */
export function allowance(companyId?: number | null): { credits: number; cap: CreditCapError["cap"] } {
  const s = getSettings();
  const limits: { credits: number; cap: CreditCapError["cap"] }[] = [
    { credits: s.dailyCreditCap - spentToday(), cap: "daily" },
  ];
  const runId = currentRunId();
  if (runId) limits.push({ credits: s.runCreditCap - sum("SELECT SUM(credits) AS n FROM credit_ledger WHERE run_id = ?", runId), cap: "run" });
  if (companyId) limits.push({ credits: s.perCompanyCreditCap - sum("SELECT SUM(credits) AS n FROM credit_ledger WHERE company_id = ?", companyId), cap: "company" });
  return limits.reduce((a, b) => (b.credits < a.credits ? b : a));
}

export function assertAllowance(companyId?: number | null): number {
  const a = allowance(companyId);
  if (a.credits <= 0) throw new CreditCapError(a.cap);
  return a.credits;
}

export function recordCall(e: {
  endpoint: string;
  credits: number;
  provider?: string | null;
  studyId?: number | null;
  companyId?: number | null;
  ok: boolean;
  note?: string;
}) {
  run(
    "INSERT INTO credit_ledger (endpoint, credits, provider, study_id, company_id, run_id, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    e.endpoint, e.credits, e.provider ?? null, e.studyId ?? null, e.companyId ?? null, currentRunId(), e.ok ? 1 : 0, e.note ?? null,
  );
}
