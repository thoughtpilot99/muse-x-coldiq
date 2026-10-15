import type { ReactNode } from "react";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  pending: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  enriching: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  paused: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ready: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  analyzed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  enriched: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  winner: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  loser: "bg-red-500/15 text-red-700 dark:text-red-300",
  skipped: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}>
      {status.replace("_", " ")}
    </span>
  );
}

/** Winner vs loser share for one trait. */
export function ShareBars({ winners, winnersKnown, losers, losersKnown }: { winners: number; winnersKnown: number; losers: number; losersKnown: number }) {
  const row = (label: string, n: number, d: number, tone: string) => (
    <div className="grid grid-cols-[56px_1fr_84px] items-center gap-2 text-xs">
      <span className="text-muted">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-subtle">
        <span className={`block h-full ${tone}`} style={{ width: `${d ? Math.max(2, (n / d) * 100) : 0}%` }} />
      </span>
      <span className="text-right tabular-nums text-muted">{n}/{d}{d ? ` · ${Math.round((n / d) * 100)}%` : ""}</span>
    </div>
  );
  return (
    <div className="space-y-1">
      {row("Winners", winners, winnersKnown, "bg-accent")}
      {losersKnown > 0 && row("Losers", losers, losersKnown, "bg-red-500")}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";
