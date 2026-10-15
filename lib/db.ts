import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type Label = "winner" | "loser";

export type StudyStatus = "draft" | "enriching" | "paused" | "ready" | "analyzed";

export type Study = {
  id: number;
  name: string;
  token: string; // public report link
  status: StudyStatus;
  lenses: string; // JSON Lens[]
  notes: string; // what the user sells, in their words
  custom_columns: string; // JSON string[] (CSV columns used as features)
  analysis: string | null; // JSON Analysis
  lookalike_filters: string | null; // JSON (what was sent to companies/search)
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyStatus = "pending" | "enriched" | "failed" | "skipped";

export type Company = {
  id: number;
  study_id: number;
  kind: "seed" | "lookalike";
  domain: string;
  name: string | null;
  label: Label | null; // null for lookalikes
  deal_value: number | null;
  custom: string; // JSON Record<string,string> from extra CSV columns
  profile: string | null; // JSON Profile (normalized enrichment)
  lenses_done: string; // JSON Lens[]
  status: CompanyStatus;
  score: number | null; // lookalikes only
  why: string | null; // lookalikes: Muse explanation
  error: string | null;
  created_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  lenses TEXT NOT NULL DEFAULT '["firmographics"]',
  notes TEXT NOT NULL DEFAULT '',
  custom_columns TEXT NOT NULL DEFAULT '[]',
  analysis TEXT,
  lookalike_filters TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'seed',
  domain TEXT NOT NULL,
  name TEXT,
  label TEXT,
  deal_value REAL,
  custom TEXT NOT NULL DEFAULT '{}',
  profile TEXT,
  lenses_done TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  score REAL,
  why TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (study_id, kind, domain)
);
CREATE INDEX IF NOT EXISTS companies_study ON companies(study_id, kind, status);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  credits REAL NOT NULL DEFAULT 0,
  provider TEXT,
  study_id INTEGER,
  company_id INTEGER,
  run_id TEXT,
  ok INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  note TEXT,
  headers TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT NOT NULL,
  lead_id INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const g = globalThis as unknown as { __idDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__idDb) {
    const file = process.env.ID_DB_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    d.exec(SCHEMA);
    g.__idDb = d;
  }
  return g.__idDb;
}

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

export const getStudy = (id: number) => get<Study>("SELECT * FROM studies WHERE id = ?", id);
export const getStudyByToken = (token: string) => get<Study>("SELECT * FROM studies WHERE token = ?", token);
export const getCompany = (id: number) => get<Company>("SELECT * FROM companies WHERE id = ?", id);

export function seeds(studyId: number) {
  return all<Company>("SELECT * FROM companies WHERE study_id = ? AND kind = 'seed' ORDER BY label DESC, id", studyId);
}

export function lookalikes(studyId: number) {
  return all<Company>(
    "SELECT * FROM companies WHERE study_id = ? AND kind = 'lookalike' ORDER BY COALESCE(score, -1) DESC, id",
    studyId,
  );
}

function update(table: "studies" | "companies", allowed: Set<string>, id: number, fields: Record<string, Param | undefined>) {
  const keys = Object.keys(fields).filter((k) => allowed.has(k) && fields[k] !== undefined);
  if (!keys.length) return;
  const touch = table === "studies" ? ", updated_at = datetime('now')" : "";
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")}${touch} WHERE id = ?`, ...keys.map((k) => fields[k] ?? null), id);
}

const STUDY_COLS = new Set(["name", "status", "lenses", "notes", "custom_columns", "analysis", "lookalike_filters", "error"]);
const COMPANY_COLS = new Set(["name", "label", "deal_value", "profile", "lenses_done", "status", "score", "why", "error"]);

export const updateStudy = (id: number, f: Partial<Record<keyof Study, Param>>) => update("studies", STUDY_COLS, id, f);
export const updateCompany = (id: number, f: Partial<Record<keyof Company, Param>>) => update("companies", COMPANY_COLS, id, f);

export function logEvent(e: { source: string; kind: string; ok: boolean; note?: string; payload?: string }) {
  run(
    "INSERT INTO events (source, kind, ok, note, payload) VALUES (?, ?, ?, ?, ?)",
    e.source, e.kind, e.ok ? 1 : 0, e.note ?? null, e.payload?.slice(0, 50_000) ?? null,
  );
}
