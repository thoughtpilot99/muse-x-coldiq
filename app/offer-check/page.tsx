import Link from "next/link";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { offerChecks } from "@/lib/db";
import { viewOf } from "@/lib/offer/check";
import { scoreLabel } from "@/lib/offer/report";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { offerCheckAction } from "../actions";

export default async function OfferCheckPage() {
  await connection();
  const checks = offerChecks().map(viewOf);
  const s = getSettings();
  const coldiq = !!config.coldiqApiKey();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Offer Check</h1>
        <p className="text-sm text-muted">
          Got a job offer? Check the company&apos;s health before you sign: funding and runway, hiring trend, team growth and news from the
          last 12 months, scored by fixed rules and explained in plain words, with questions to ask in your interview.
        </p>
      </div>

      <ActionForm action={offerCheckAction} submit={[{ label: "Check this company" }]} className="space-y-4">
        <Card title="Company">
          {!coldiq && (
            <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">
              Connect ColdIQ on the <Link href="/setup" className="underline">Setup</Link> page first. Offer Check needs its data.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs text-muted">Company website</span>
              <input name="website" required placeholder="e.g. linear.app" className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted">Your role (optional, to check whether that team is hiring)</span>
              <input name="role" placeholder="e.g. Account Executive" className={`${inputClass} mt-1`} />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">
            About 11 ColdIQ credits per company (never more than {s.offerCheckCreditCap}). Checking the same company again within 7 days is
            free. Your role stays on this computer; nothing about you is sent anywhere except to Muse Wonder for the explanation.
          </p>
        </Card>
      </ActionForm>

      <Card title="Past checks">
        {checks.length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-1">Company</th><th>Role</th><th>Score</th><th>Credits</th><th>Date</th></tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="py-2"><Link href={`/offer-check/${c.id}`} className="font-medium underline">{c.factsData?.company.name ?? c.domain}</Link></td>
                  <td className="text-muted">{c.role ?? "–"}</td>
                  <td className="tabular-nums">{c.resultData ? `${c.resultData.score ?? "–"} · ${scoreLabel(c.resultData.score)}` : c.status === "failed" ? "failed" : "–"}</td>
                  <td className="tabular-nums">{Math.round(c.credits * 100) / 100}</td>
                  <td className="text-muted">{c.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <p className="text-sm text-muted">No checks yet.</p>
        )}
      </Card>
    </div>
  );
}
