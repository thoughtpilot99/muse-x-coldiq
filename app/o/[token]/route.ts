import { getOfferCheckByToken } from "@/lib/db";
import { viewOf } from "@/lib/offer/check";
import { offerReportHtml } from "@/lib/offer/report";

/** The site's public origin, for the absolute og:image link (works behind a proxy). */
function originOf(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

// Public Offer Check report. The token is unguessable; the page holds no names or raw data.
export async function GET(req: Request, ctx: RouteContext<"/o/[token]">) {
  const { token } = await ctx.params;
  const row = /^[A-Za-z0-9_-]{16}$/.test(token) ? getOfferCheckByToken(token) : undefined;
  const html = row ? offerReportHtml(viewOf(row), originOf(req)) : "";
  if (!html) return new Response("Report not found", { status: 404 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
    },
  });
}
