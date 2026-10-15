# Security

ICP Detective is a **local, single-user** app. Please keep it that way unless you add your own authentication.

## Your API keys
- Keys entered on the **Setup** page are stored in `data/app.db` on your machine. Keys in `.env.local` override them.
- Both `data/` and `.env*` (except `.env.example`) are gitignored. Never commit them, and never paste keys into issues or pull requests.
- If a key leaks, rotate it at the provider (Meta Model API, ColdIQ) and paste the new one on the Setup page.

## Your customer data
- The CSV you upload is stored in `data/app.db` only.
- Company domains (and names, for the advertising lens) are sent to ColdIQ for enrichment.
- Muse Wonder receives the trait table (labels and counts), not company names or domains.
- The public report at `/report/<token>` contains aggregates only. Anyone with the link can open it, so share it deliberately. Delete the study to remove it. The same goes for Offer Check pages at `/o/<token>`: they show computed facts and roles, never names or raw provider data.

## Exposing the app
A tunnel (for example `cloudflared tunnel --url http://localhost:3000`) makes the **whole UI** reachable. Set `APP_PASSWORD` in `.env.local` **before** starting it. Every page except `/report/<token>` and `/o/<token>` then requires it.

## Spending
ColdIQ calls are capped per run, per day and per company (Settings), and each call carries `max_credits` equal to the smallest remaining cap.

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository rather than a public issue.
