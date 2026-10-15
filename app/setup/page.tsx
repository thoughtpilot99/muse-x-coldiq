import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { config } from "@/lib/config";
import { getSecret, mask, secretSource, type SecretName } from "@/lib/secrets";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { saveKeyAction, testColdiqAction, testMuseAction } from "./actions";

function KeyField({ name, label, help }: { name: SecretName; label: string; help: ReactNode }) {
  const source = secretSource(name);
  const current = process.env[name] || getSecret(name);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={source === "none" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {source === "none" ? "not connected" : `connected ${mask(current)}${source === "env" ? " (from .env.local)" : ""}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{help}</p>
      {source !== "env" && (
        <ActionForm action={saveKeyAction} submit={[{ label: source === "app" ? "Replace" : "Save", tone: "neutral" }]}>
          <input type="hidden" name="name" value={name} />
          <input name="value" type="password" autoComplete="off" placeholder={source === "app" ? "Paste a new key, or leave empty to remove" : "Paste key"} className={`${inputClass} mt-2`} />
        </ActionForm>
      )}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <Card title={`${n}. ${title}`} actions={<span className={done ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-sm text-muted"}>{done ? "✓ done" : "to do"}</span>}>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default async function SetupPage() {
  await connection();
  const s = getSettings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-sm text-muted">
          Connect your own accounts. Keys are stored only on this computer (in <code>data/app.db</code>, never committed). Values in{" "}
          <code>.env.local</code> take precedence.
        </p>
      </div>

      <Step n={1} title="Muse Wonder (the analyst)" done={!!config.museApiKey()}>
        <KeyField name="MODEL_API_KEY" label="Meta Model API key"
          help={<>Create one at <a className="underline" href="https://dev.meta.ai" target="_blank" rel="noreferrer">dev.meta.ai</a> → API keys. Model: <code>{config.museModel()}</code>. One analysis costs a few cents.</>} />
        {config.museApiKey() && <ActionForm action={testMuseAction} submit={[{ label: "Test Muse Wonder", tone: "neutral" }]} />}
      </Step>

      <Step n={2} title="ColdIQ (the data)" done={!!config.coldiqApiKey()}>
        <KeyField name="COLDIQ_API_KEY" label="ColdIQ API key"
          help={<>Sign up at <a className="underline" href="https://login.coldiq.com/sign-up" target="_blank" rel="noreferrer">coldiq.com</a> (300 free credits, no card), then create an API key in the dashboard. Optional: studies that only use your own CSV columns don&apos;t need it.</>} />
        {config.coldiqApiKey() && <ActionForm action={testColdiqAction} submit={[{ label: "Test ColdIQ (free)", tone: "neutral" }]} />}
        <p className="text-xs text-muted">
          Spending limits: {s.runCreditCap} credits per run, {s.dailyCreditCap} per day, {s.perCompanyCreditCap} per company. Change them in{" "}
          <Link href="/settings" className="underline">Settings</Link>.
        </p>
      </Step>

      <Step n={3} title="Describe what you sell" done={!!s.offer}>
        <p className="text-sm">
          One or two sentences on the <Link className="underline" href="/settings">Settings</Link> page. It helps Muse Wonder judge which traits matter for your product.
        </p>
      </Step>

      <Step n={4} title="Upload your customers" done={false}>
        <p className="text-sm">
          Export your customers (and, ideally, churned customers or lost deals) as a CSV and start a <Link className="underline" href="/studies/new">new study</Link>.
        </p>
      </Step>
    </div>
  );
}
