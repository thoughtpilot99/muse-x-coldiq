import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { config, missingKeys } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ICP Detective",
  description: "Find out who your best customers really are. ColdIQ data, Muse Wonder analysis, numbers computed in code.",
};

const NAV = [
  { href: "/", label: "Studies" },
  { href: "/studies/new", label: "New study" },
  { href: "/events", label: "Events" },
  { href: "/settings", label: "Settings" },
  { href: "/setup", label: "Setup" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  const missing = [...missingKeys(), ...(config.coldiqApiKey() ? [] : [{ key: "COLDIQ_API_KEY", label: "ColdIQ (optional for CSV-only studies)" }])];
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold">
              ICP <span className="text-accent">Detective</span>
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm text-muted">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-foreground">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {missing.length > 0 && (
          <div className="border-b border-amber-500/40 bg-amber-500/10">
            <div className="mx-auto max-w-6xl px-4 py-2 text-sm">
              <strong>Not connected yet:</strong> {missing.map((m) => m.label).join(", ")}. Add keys on the{" "}
              <Link href="/setup" className="underline">Setup</Link> page.
            </div>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
