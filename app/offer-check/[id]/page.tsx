import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { getOfferCheck } from "@/lib/db";
import { viewOf } from "@/lib/offer/check";
import { DISCLAIMER, LEVEL_COLOR, LEVEL_TEXT, scoreLabel } from "@/lib/offer/report";
import { ActionForm } from "@/components/ActionForm";
import { Card, Stat } from "@/components/ui";
import { refreshOfferAction } from "../../actions";

const money = (n: number) => (n >= 1e9 ? `$${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

function List({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>;
}

export default async function OfferCheckDetail({ params }: PageProps<"/offer-check/[id]">) {
  await connection();
  const { id } = await params;
  const row = getOfferCheck(Number(id));
  if (!row) notFound();
  const c = viewOf(row);
  const f = c.factsData;
  const r = c.resultData;
  const a = c.analysisData;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/offer-check" className="text-sm text-muted underline">Offer Check</Link>
        <h1 className="text-2xl font-semibold">{f?.company.name ?? c.domain}</h1>
        <p className="text-sm text-muted">{c.domain}{c.role ? ` · ${c.role}` : ""}{c.fetched_at ? ` · data from ${c.fetched_at.slice(0, 10)}` : ""}</p>
      </div>

      {c.error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{c.error}</p>}

      {r && f && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Score" value={r.score ?? "–"} hint={`${scoreLabel(r.score, r.coverage)} · ${Math.round(r.coverage * 100)}% of the data areas known`} />
            <Stat label="Credits used" value={Math.round(c.credits * 100) / 100} hint="Repeat checks within 7 days are free" />
            <Stat label="Share" value={<a href={`/o/${c.token}`} target="_blank" className="text-base underline">Open public report</a>} hint="No names or raw data; not indexed" />
          </div>

          {a && <p className="text-lg">{a.verdict}</p>}
          {!a && !config.museApiKey() && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">Connect Muse Wonder on the <Link href="/setup" className="underline">Setup</Link> page to get the plain-language verdict and interview questions. The score below doesn&apos;t need it.</p>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            {r.areas.map((x) => (
              <div key={x.key} className="rounded-lg border border-line bg-panel p-3">
                <span className="inline-block rounded-full px-2 py-0.5 text-xs text-white" style={{ background: LEVEL_COLOR[x.level] }}>{LEVEL_TEXT[x.level]}</span>
                <div className="mt-1 font-medium">{x.label}</div>
                <p className="text-sm text-muted">{x.reason}</p>
              </div>
            ))}
          </div>

          {a && (
            <div className="grid gap-3 md:grid-cols-2">
              {a.good.length > 0 && <Card title="What looks good"><List items={a.good} /></Card>}
              {a.worries.length > 0 && <Card title="What to watch"><List items={a.worries} /></Card>}
              <Card title="Questions to ask in the interview"><List items={a.questions} /></Card>
              <Card title="Limits of this check"><List items={a.caveats} /></Card>
            </div>
          )}
          {a?.unverified.length ? (
            <p className="rounded-md border-l-4 border-red-500 bg-panel px-3 py-2 text-sm"><b>Not verified against the data:</b> {a.unverified.join(" · ")}</p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <Card title="Funding">
              {f.funding.rounds.length ? <List items={f.funding.rounds.slice(0, 8).map((x) => `${x.type}${x.amountUsd ? `, ${money(x.amountUsd)}` : ""}${x.date ? `, ${x.date}` : ""}`)} /> : <p className="text-sm text-muted">No funding rounds found.</p>}
            </Card>
            <Card title="Hiring">
              {f.hiring.known ? (
                <List items={[
                  `Open roles now: ${f.hiring.openNow}`,
                  `Open roles 90 days ago: ${f.hiring.open90DaysAgo}`,
                  `New roles, last 90 days: ${f.hiring.newLast90} (90 days before: ${f.hiring.newPrior90})`,
                  ...(f.hiring.roleDepartment ? [`Open ${f.hiring.roleDepartment} roles now: ${f.hiring.roleOpenNow}`] : []),
                ]} />
              ) : <p className="text-sm text-muted">No job posting data found.</p>}
            </Card>
            <Card title="News, last 12 months">
              {[...f.news.warnings, ...f.news.departures, ...f.news.positives].length ? (
                <List items={[...f.news.warnings, ...f.news.departures, ...f.news.positives].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12).map((n) => `${n.date}: ${n.label}`)} />
              ) : <p className="text-sm text-muted">{f.news.known ? "Nothing notable." : "No news coverage found."}</p>}
            </Card>
          </div>

          <p className="text-xs text-muted">
            Sources: {Object.entries(f.sources).map(([k, v]) => `${k} ${v}`).join(", ")}. {DISCLAIMER} Raw responses are on the <Link href="/events" className="underline">Events</Link> page.
          </p>
        </>
      )}

      <ActionForm action={refreshOfferAction} submit={[{ label: r ? "Refresh" : "Try again", tone: "neutral" }]}>
        <input type="hidden" name="id" value={c.id} />
        <p className="text-xs text-muted">Uses the saved data if it is less than 7 days old (free); otherwise fetches it again from ColdIQ.</p>
      </ActionForm>
    </div>
  );
}
