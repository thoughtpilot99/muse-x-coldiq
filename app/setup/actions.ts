"use server";

import { revalidatePath } from "next/cache";
import { isSecretName, setSecret } from "@/lib/secrets";
import { pingMuse } from "@/lib/muse";
import { getBalance } from "@/lib/coldiq";
import type { ActionResult } from "../actions";

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Save (or clear, when empty) one key entered on the setup page. */
export async function saveKeyAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const name = str(fd, "name");
    if (!isSecretName(name)) throw new Error("Unknown setting");
    if (process.env[name]) throw new Error(`${name} is set in .env.local, which takes precedence. Change it there.`);
    const value = str(fd, "value");
    if (value.length > 500 || /\s/.test(value)) throw new Error("That doesn't look like a key (no spaces, max 500 characters)");
    setSecret(name, value);
    return value ? "Saved." : "Cleared.";
  });
}

export async function testMuseAction(): Promise<ActionResult> {
  return attempt(async () => `Connected to ${await pingMuse()}.`);
}

/** Free call: reads the balance, spends nothing. */
export async function testColdiqAction(): Promise<ActionResult> {
  return attempt(async () => {
    const b = await getBalance();
    return `Connected. ${Math.floor(b.balance)} credits left (≈ $${(b.balance * b.usd_per_credit).toFixed(2)}), ${Math.round(b.usedThisMonth)} used this month.`;
  });
}
