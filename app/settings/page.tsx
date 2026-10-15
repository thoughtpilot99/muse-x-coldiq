import Link from "next/link";
import { connection } from "next/server";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { saveSettingsAction } from "../actions";

export default async function SettingsPage() {
  await connection();
  const s = getSettings();
  const field = (name: keyof typeof s, label: string, hint?: string) => (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input name={name} type="number" min={0} step="any" defaultValue={String(s[name])} className={`${inputClass} mt-1`} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Keys are on the <Link href="/setup" className="underline">Setup</Link> page.</p>
      </div>
      <ActionForm action={saveSettingsAction} submit={[{ label: "Save settings" }]} className="space-y-4">
        <Card title="What you sell">
          <textarea name="offer" rows={3} defaultValue={s.offer} className={inputClass}
            placeholder="e.g. Inventory software for Shopify brands doing $1-20M a year. Replaces spreadsheets for ops teams." />
        </Card>
        <Card title="ColdIQ spending limits (credits)">
          <div className="grid gap-3 md:grid-cols-3">
            {field("runCreditCap", "Per run", "One press of Enrich or Find lookalikes")}
            {field("dailyCreditCap", "Per day")}
            {field("perCompanyCreditCap", "Per company", "Across all lenses")}
          </div>
          <p className="mt-3 text-xs text-muted">ColdIQ charges only when data is found. These caps are also sent with every call as max_credits, so a call can never cost more than what is left.</p>
        </Card>
        <Card title="Offer Check">
          <div className="grid gap-3 md:grid-cols-3">
            {field("offerCheckCreditCap", "Credits per check", "A full check costs about 11")}
            {field("costPerHeadLow", "Monthly cost per employee, low ($)", "For the runway estimate")}
            {field("costPerHeadHigh", "Monthly cost per employee, high ($)")}
          </div>
        </Card>
        <Card title="Analysis">
          <div className="grid gap-3 md:grid-cols-2">
            {field("minSupport", "Minimum support", "A trait must appear in at least this many companies to count")}
            {field("lookalikeLimit", "Lookalikes per search", "1-100")}
          </div>
        </Card>
      </ActionForm>
    </div>
  );
}
