import Link from "next/link";
import { connection } from "next/server";
import { all, get } from "@/lib/db";
import { config } from "@/lib/config";
import { getBalance, type CreditBalance } from "@/lib/coldiq";
import { spentToday } from "@/lib/credits";
import { getSettings } from "@/lib/settings";
import { Checklist } from "@/components/Checklist";
import { Badge, Card, Stat } from "@/components/ui";

type Row = { id: number; name: string; status: string; created_at: string; winners: number; losers: number; lookalikes: number; credits: number | null };

export default async function Home() {
  await connection();
  const s = getSettings();
  const studies = all<Row>(`
    SELECT s.id, s.name, s.status, s.created_at,
      (SELECT COUNT(*) FROM companies c WHERE c.study_id = s.id AND c.kind = 'seed' AND c.label = 'winner') AS winners,
      (SELECT COUNT(*) FROM companies c WHERE c.study_id = s.id AND c.kind = 'seed' AND c.label = 'loser') AS losers,
      (SELECT COUNT(*) FROM companies c WHERE c.study_id = s.id AND c.kind = 'lookalike') AS lookalikes,
      (SELECT SUM(credits) FROM credit_ledger l WHERE l.study_id = s.id) AS credits
    FROM studies s ORDER BY s.id DESC`);
  let balance: CreditBalance | null = null;
  let balanceError = "";
  if (config.coldiqApiKey()) {
    try {
      balance = await getBalance();
    } catch (e) {
      balanceError = e instanceof Error ? e.message : String(e);
    }
  }
  const ai = get<{ cost: number | null }>("SELECT SUM(cost_usd) AS cost FROM ai_runs") ?? { cost: 0 };
  const today = spentToday();
  const analyzed = studies.some((st) => st.status === "analyzed");

  const checklist = [
    { label: "Connect Muse Wonder", done: !!config.museApiKey(), href: "/setup" },
    { label: "Connect ColdIQ (300 free credits)", done: !!config.coldiqApiKey(), href: "/setup" },
    { label: "Describe what you sell", done: !!s.offer, href: "/settings" },
    { label: "Upload your customers", done: studies.length > 0, href: "/studies/new" },
    { label: "Get your ICP report", done: analyzed, href: studies[0] ? `/studies/${studies[0].id}` : "/studies/new" },
    { label: "Find lookalike accounts", done: studies.some((st) => st.lookalikes > 0), href: studies[0] ? `/studies/${studies[0].id}` : "/studies/new" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Who are your best customers, really?</h1>
          <p className="text-sm text-muted">
            Upload winners and losers. ColdIQ fills in the data, code counts the traits, Muse Wonder explains the pattern.
          </p>
        </div>
        <Link href="/studies/new" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">New study</Link>
      </div>

      <Checklist items={checklist} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="ColdIQ balance"
          value={balance ? Math.floor(balance.balance) : "–"}
          hint={balance ? `≈ $${(balance.balance * balance.usd_per_credit).toFixed(2)} at $${balance.usd_per_credit.toFixed(4)}/credit` : balanceError || "Connect ColdIQ on Setup"}
        />
        <Stat label="Credits spent today" value={`${Math.round(today * 10) / 10} / ${s.dailyCreditCap}`} hint="Daily cap, set in Settings" />
        <Stat label="Per run cap" value={s.runCreditCap} hint={`Max ${s.perCompanyCreditCap} credits per company`} />
        <Stat label="Muse Wonder spend" value={`$${(ai.cost ?? 0).toFixed(2)}`} hint="All analyses so far" />
      </div>

      <Card title="Studies">
        {studies.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">Study</th><th className="py-2 pr-3">Winners</th><th className="py-2 pr-3">Losers</th>
                  <th className="py-2 pr-3">Lookalikes</th><th className="py-2 pr-3">Credits used</th><th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {studies.map((st) => (
                  <tr key={st.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3"><Link href={`/studies/${st.id}`} className="font-medium hover:underline">{st.name}</Link></td>
                    <td className="py-2 pr-3 tabular-nums">{st.winners}</td>
                    <td className="py-2 pr-3 tabular-nums">{st.losers}</td>
                    <td className="py-2 pr-3 tabular-nums">{st.lookalikes}</td>
                    <td className="py-2 pr-3 tabular-nums">{Math.round((st.credits ?? 0) * 10) / 10}</td>
                    <td className="py-2"><Badge status={st.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No studies yet. <Link href="/studies/new" className="underline">Upload your customers</Link> to start.</p>
        )}
      </Card>
    </div>
  );
}
