import { connection } from "next/server";
import { config } from "@/lib/config";
import { LENSES } from "@/lib/enrich";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { createStudyAction } from "../../actions";

const EXAMPLE = `domain,name,label,deal_value,plan
northwind.example,Northwind,winner,24000,Pro
contoso.example,Contoso,winner,18000,Pro
fabrikam.example,Fabrikam,loser,3000,Starter`;

export default async function NewStudyPage() {
  await connection();
  const s = getSettings();
  const coldiq = !!config.coldiqApiKey();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New study</h1>
        <p className="text-sm text-muted">
          Upload the companies you know best: your best customers (<strong>winners</strong>) and, if you can, churned customers or lost deals
          (<strong>losers</strong>). The comparison is what makes the result trustworthy.
        </p>
      </div>

      <ActionForm action={createStudyAction} submit={[{ label: "Create study" }]} className="space-y-4">
        <Card title="1. Your customers">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-xs text-muted">Study name</span>
              <input name="name" required placeholder="e.g. 2026 customers vs churned" className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted">CSV file (exported from your CRM or a spreadsheet)</span>
              <input name="file" type="file" accept=".csv,text/csv,text/plain" className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted">…or paste it</span>
              <textarea name="csv" rows={6} placeholder={EXAMPLE} className={`${inputClass} mt-1 font-mono`} />
            </label>
            <div className="rounded-md bg-subtle p-3 text-xs text-muted">
              <p><strong className="text-foreground">Columns:</strong> <code>domain</code> (or website, required), <code>name</code>, <code>label</code> (winner/loser, also
                accepts won/lost, customer/churned, yes/no; empty means winner), <code>deal_value</code> (or ARR, MRR, amount).</p>
              <p className="mt-1">Any other column (plan, source, region, use case…) is analysed too, up to 10 columns. Those cost no credits.</p>
              <p className="mt-1"><a href="/icp-detective-template.csv" download className="underline">Download a template</a></p>
            </div>
          </div>
        </Card>

        <Card title="2. What ColdIQ should look up">
          {!coldiq && (
            <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">
              ColdIQ isn&apos;t connected, so only your own CSV columns can be analysed. Connect it on Setup to add the lenses below.
            </p>
          )}
          <div className="space-y-2">
            {Object.entries(LENSES).map(([key, l]) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="lenses" value={key} defaultChecked={coldiq && key === "firmographics"} disabled={!coldiq} className="mt-1" />
                <span><strong>{l.label}</strong> <span className="text-muted">· {l.detail}</span></span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Each lens is one ColdIQ call per company, charged only when data is found and never more than {s.perCompanyCreditCap} credits per
            company. A run stops at {s.runCreditCap} credits and a day at {s.dailyCreditCap} (change these in Settings). You can continue a paused study any time.
          </p>
        </Card>

        <Card title="3. Context (optional)">
          <label className="block text-sm">
            <span className="text-xs text-muted">Anything the analysis should know, e.g. &quot;losers are deals lost on price in 2025&quot;</span>
            <textarea name="notes" rows={3} className={`${inputClass} mt-1`} />
          </label>
        </Card>
      </ActionForm>
    </div>
  );
}
