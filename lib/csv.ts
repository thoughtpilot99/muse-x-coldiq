import type { Label } from "./db";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). Keeps the original headers. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Spreadsheet exports use commas, semicolons (EU locales) or tabs; pick the one in the header row.
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  return { headers: nonEmpty[0].map((h) => h.trim()), rows: nonEmpty.slice(1).map((r) => r.map((c) => c.trim())) };
}

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s || /\s/.test(s)) return null;
  try {
    const host = new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES = {
  domain: ["domain", "website", "url", "companydomain", "companywebsite", "site", "web"],
  name: ["company", "name", "companyname", "account", "accountname", "organization"],
  label: ["label", "outcome", "status", "type", "segment", "result", "group"],
  value: ["dealvalue", "value", "arr", "mrr", "acv", "amount", "revenue", "ltv"],
};

const WINNER = /^(winner|win|won|best|good|customer|active|retained|yes|y|1|true|top)$/i;
const LOSER = /^(loser|lose|lost|churn|churned|bad|cancelled|canceled|no|n|0|false|worst)$/i;

export function parseLabel(v: string | undefined): Label | null {
  if (!v) return "winner"; // a plain list of customers counts as winners
  if (WINNER.test(v.trim())) return "winner";
  if (LOSER.test(v.trim())) return "loser";
  return null;
}

export type ImportRow = { domain: string; name: string | null; label: Label; dealValue: number | null; custom: Record<string, string> };

export const MAX_CUSTOM_COLUMNS = 10;

/** Map a customer CSV to rows. Columns that aren't domain/name/label/value become custom traits. */
export function toImportRows(text: string): { rows: ImportRow[]; skipped: string[]; customColumns: string[] } {
  const { headers, rows } = parseCsv(text);
  const find = (aliases: string[]) => headers.findIndex((h) => aliases.includes(key(h)));
  const di = find(ALIASES.domain);
  if (di < 0) throw new Error(`The CSV needs a domain or website column. Found: ${headers.join(", ") || "nothing"}`);
  const ni = find(ALIASES.name);
  const li = find(ALIASES.label);
  const vi = find(ALIASES.value);
  const used = new Set([di, ni, li, vi]);
  const customIdx = headers.map((h, i) => i).filter((i) => !used.has(i) && headers[i]).slice(0, MAX_CUSTOM_COLUMNS);

  const out: ImportRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const domain = normalizeDomain(r[di]);
    const label = parseLabel(li >= 0 ? r[li] : undefined);
    if (!domain || !label) {
      skipped.push(r[di] || "(empty)");
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    const value = vi >= 0 ? Number(String(r[vi] ?? "").replace(/[^0-9.]/g, "")) : NaN;
    out.push({
      domain,
      name: ni >= 0 ? r[ni] || null : null,
      label,
      dealValue: Number.isFinite(value) && value > 0 ? value : null,
      custom: Object.fromEntries(customIdx.map((i) => [headers[i], (r[i] ?? "").slice(0, 80)]).filter(([, v]) => v)),
    });
  }
  return { rows: out, skipped, customColumns: customIdx.map((i) => headers[i]) };
}
