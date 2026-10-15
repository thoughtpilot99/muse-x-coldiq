import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getStudy, lookalikes, seeds } from "@/lib/db";
import { config } from "@/lib/config";
import { spentOnStudy } from "@/lib/credits";
import { LENSES, type Lens } from "@/lib/enrich";
import { parseJson, studyStats, type StoredAnalysis } from "@/lib/pipeline";
import type { Profile } from "@/lib/profile";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, ShareBars, Stat, inputClass } from "@/components/ui";
import { analyzeAction, deleteStudyAction, enrichAction, lookalikesAction, skipEnrichAction } from "../../actions";

function TraitList({ title, hint, refs, a }: { title: string; hint: string; refs: { trait_id: string; why: string }[]; a: StoredAnalysis }) {
  const items = refs.filter((r) => a.refs[r.trait_id]);
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((r) => {
          const t = a.refs[r.trait_id];
          return (
            <div key={r.trait_id} className="rounded-md border border-line p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted">{t.group}</div>
              <div className="font-medium">{t.label}</div>
              <p className="my-1 text-sm">{r.why}</p>
              <ShareBars winners={t.winners} winnersKnown={t.winnersKnown} losers={t.losers} losersKnown={t.losersKnown} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const fmt = (p: Profile) =>
  [p.industry, p.employees && `${p.employees.toLocaleString()} people`, p.country, p.fundingStage].filter(Boolean).join(" · ") || "–";

export default async function StudyPage({ params }: PageProps<"/studies/[id]">) {
  await connection();
  const { id } = await params;
  const study = getStudy(Number(id));
  if (!study) notFound();

  const companies = seeds(study.id);
  const looks = lookalikes(study.id);
  const lenses = parseJson<Lens[]>(study.lenses, []);
  const customColumns = parseJson<string[]>(study.custom_columns, []);
  const analysis = parseJson<StoredAnalysis | null>(study.analysis, null);
  const stats = studyStats(study.id);
  const by = (st: string) => companies.filter((c) => c.status === st).length;
  const pending = by("pending");
  const failed = by("failed");
  const credits = spentOnStudy(study.id);
  const hidden = { name: "id", value: study.id };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted hover:underline">← Studies</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{study.name}</h1>
          <Badge status={study.status} />
        </div>
        <p className="text-sm text-muted">
          Lenses: {lenses.map((l) => LENSES[l].label).join(", ") || "none (CSV columns only)"}
          {customColumns.length > 0 && <> · Your columns: {customColumns.join(", ")}</>}
        </p>
        {study.error && <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm">{study.error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Winners" value={stats.winners} />
        <Stat label="Losers" value={stats.losers} hint={stats.losers ? undefined : "Add churned or lost accounts for a real comparison"} />
        <Stat label="Traits found" value={stats.traits.length} hint="Shared by enough companies to count" />
        <Stat label="ColdIQ credits used" value={Math.round(credits * 10) / 10} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="1. Enrich">
          <p className="text-sm">
            {companies.length - pending - failed} of {companies.length} done{pending ? `, ${pending} waiting` : ""}{failed ? `, ${failed} failed` : ""}.
          </p>
          {lenses.length > 0 && (pending > 0 || failed > 0) && (
            config.coldiqApiKey() ? (
              <>
                <ActionForm action={enrichAction} submit={[
                  { label: study.status === "paused" ? "Continue" : "Enrich with ColdIQ" },
                  ...(failed ? [{ label: "Retry failed", intent: "retry", tone: "neutral" as const }] : []),
                ]}>
                  <input type="hidden" {...hidden} />
                </ActionForm>
                <ActionForm action={skipEnrichAction} submit={[{ label: "Analyse with what I have", tone: "neutral" }]}>
                  <input type="hidden" {...hidden} />
                </ActionForm>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">Connect ColdIQ on <Link href="/setup" className="underline">Setup</Link> to enrich.</p>
            )
          )}
        </Card>
        <Card title="2. Analyse">
          <p className="text-sm text-muted">Muse Wonder reads the trait table below and writes your ICP. Every count it cites is checked against the data.</p>
          <ActionForm action={analyzeAction} submit={[{ label: analysis ? "Re-run analysis" : "Find my ICP", tone: analysis ? "neutral" : "primary" }]}>
            <input type="hidden" {...hidden} />
          </ActionForm>
        </Card>
        <Card title="3. Lookalikes">
          <p className="text-sm text-muted">ColdIQ searches for companies like your best winners, narrowed by the ICP. Each is scored in code.</p>
          {analysis && config.coldiqApiKey() ? (
            <ActionForm action={lookalikesAction} submit={[{ label: looks.length ? "Search again" : "Find lookalikes", tone: looks.length ? "neutral" : "primary" }]}>
              <input type="hidden" {...hidden} />
            </ActionForm>
          ) : (
            <p className="mt-2 text-sm text-muted">{analysis ? "Connect ColdIQ to search." : "Run the analysis first."}</p>
          )}
        </Card>
      </div>

      {analysis && (
        <Card
          title="Your ICP"
          actions={
            <div className="flex gap-3 text-sm">
              <a href={`/report/${study.token}`} target="_blank" rel="noreferrer" className="underline">Shareable report</a>
              <a href={`/report/${study.token}?download=1`} className="underline">Download HTML</a>
            </div>
          }
        >
          <p className="text-xl font-semibold">{analysis.headline}</p>
          <p className="mt-2 text-sm">{analysis.icp_summary}</p>
          {analysis.unverified.length > 0 && (
            <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">
              <strong>Not verified against the data:</strong> {analysis.unverified.join(" · ")}
            </p>
          )}
          <div className="mt-4 space-y-5">
            <TraitList title="Must-have" hint="What most clearly separates winners from losers." refs={analysis.must_have} a={analysis} />
            <TraitList title="Nice to have" hint="Positive, weaker evidence." refs={analysis.nice_to_have} a={analysis} />
            <TraitList title="Anti-ICP" hint="More common among losers." refs={analysis.anti_icp} a={analysis} />
            <TraitList title="Surprises" hint="Worth a second look." refs={analysis.surprises} a={analysis} />
            {analysis.caveats.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Caveats</h3>
                <ul className="list-disc pl-5 text-sm">{analysis.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-muted">Analysed {analysis.sample.winners} winners and {analysis.sample.losers} losers on {analysis.generatedAt.slice(0, 10)}. The shareable report contains no customer names.</p>
        </Card>
      )}

      {looks.length > 0 && (
        <Card title={`Lookalike accounts (${looks.length})`} actions={<a href={`/studies/${study.id}/export?kind=lookalike`} className="text-sm underline">Export CSV</a>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line"><th className="py-2 pr-3">Company</th><th className="py-2 pr-3">Fit</th><th className="py-2 pr-3">Profile</th><th className="py-2">Why</th></tr>
              </thead>
              <tbody>
                {looks.map((c) => (
                  <tr key={c.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{c.name ?? c.domain}</a><div className="text-xs text-muted">{c.domain}</div></td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{c.score ?? "–"}</td>
                    <td className="py-2 pr-3 text-xs">{fmt(parseJson(c.profile, {}))}</td>
                    <td className="py-2 text-xs text-muted">{c.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={`All traits (${stats.traits.length})`}>
        {stats.traits.length ? (
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {stats.traits.slice(0, 60).map((t) => (
              <div key={t.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span><span className="text-xs text-muted">{t.group} · </span>{t.label}</span>
                  {t.lift !== null && <span className="text-xs tabular-nums text-muted">lift {t.lift.toFixed(1)}</span>}
                </div>
                <ShareBars winners={t.winners} winnersKnown={t.winnersKnown} losers={t.losers} losersKnown={t.losersKnown} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No trait is shared by enough companies yet. Enrich the list, or lower &quot;minimum support&quot; in Settings.</p>
        )}
      </Card>

      <Card title={`Your companies (${companies.length})`} actions={<a href={`/studies/${study.id}/export?kind=seed`} className="text-sm underline">Export CSV</a>}>
        <details>
          <summary className="cursor-pointer text-sm text-muted">Show the list</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3">{c.name ?? c.domain}<div className="text-xs text-muted">{c.domain}</div></td>
                    <td className="py-2 pr-3">{c.label && <Badge status={c.label} />}</td>
                    <td className="py-2 pr-3 text-xs">{fmt(parseJson(c.profile, {}))}</td>
                    <td className="py-2 text-xs"><Badge status={c.status} />{c.error && <div className="mt-1 text-red-600 dark:text-red-400">{c.error}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card title="Delete study">
        <ActionForm action={deleteStudyAction} submit={[{ label: "Delete", tone: "danger" }]}>
          <input type="hidden" {...hidden} />
          <input name="confirm" placeholder={`Type "${study.name}" to confirm`} className={`${inputClass} max-w-sm`} />
        </ActionForm>
      </Card>
    </div>
  );
}
