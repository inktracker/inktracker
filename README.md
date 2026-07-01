# InkTracker

Multi-tenant SaaS for screen-print & embroidery shops: quoting, production
tracking, orders, invoicing, customer/broker portals, and two-way QuickBooks
sync. Each shop's data is isolated by Supabase Row-Level Security, scoped by
`shop_owner` (email).

## Stack

- **Frontend:** React 18 · Vite · React Router v6 · Tailwind CSS · Radix UI
- **Backend:** Supabase — Postgres + RLS, Deno edge functions, Storage
- **Hosting:** Vercel (frontend) · Supabase (edge functions) — **two separate deploy targets**
- **Payments:** Stripe (subscription billing + customer quote payments)
- **Accounting:** QuickBooks Online (invoices, expenses, payment sync)
- **Suppliers:** S&S Activewear + AS Colour APIs (live garment pricing/inventory)
- **Email:** Resend (from `quotes@inktracker.app`)
- **Domain:** inktracker.app

Data is accessed through the `base44.entities.*` wrapper over Supabase.
See `CLAUDE.md` for the full architecture map, pages, and edge-function list.

## Setup

```bash
npm install
# create .env.local with the values below
npm run dev
```

Required env vars in `.env.local`:

| Var | Purpose |
|-----|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |

Server-side scripts and migrations additionally need `SUPABASE_SERVICE_ROLE_KEY`
(kept in the macOS Keychain locally; injected via `./scripts/with-secrets.sh`).

## Testing

```bash
npm test                    # vitest unit/contract tests + eslint (CI gate)
npm run test:watch          # watch mode
npm run check:functions     # esbuild-parse every edge function
npm run e2e                 # Playwright end-to-end specs
```

`npm test` chains eslint — unused imports fail the build. A green `vitest` run
alone is **not** CI-green; run the full `npm test`.

## Pre-deploy gates (do not bypass)

The "public wizard total drops the blank cost" bug shipped twice. Three gates
guard it, all run by `npm run predeploy`:

1. **`npm test`** — unit + contract + render-path tests.
2. **`npm run audit:wizard`** — connects to prod via service-role key and fails
   if any shop's `wizard_styles[]` is missing `garmentCost` / `priceMap`.
3. Edge-function **smoke tests** (`npm run smoke:functions`) — ping each
   anonymous wizard function with the real payload; fail on any JWT/auth reject.

Any change to pricing/wizard files (`OrderWizard.jsx`, `pricing.jsx`,
`QuoteRequest.jsx`, `src/lib/wizard/*`, `ssLookupStyle`, `acLookupStyle`, …)
must pass all three.

## Deploy

Frontend and edge functions ship separately — **`npm run deploy` is the
canonical path** and chains both:

```bash
npm run deploy   # deploy:functions → smoke:functions → vercel --prod --yes
```

- Never run `vercel --prod` directly when touching wizard/pricing or
  `supabase/functions/*` — it bypasses the audit and the edge-function deploy.
- Edge functions are invisible to prod until
  `npx supabase functions deploy <name> --no-verify-jwt` runs (the
  `--no-verify-jwt` flag is required so the anonymous public wizard can call
  them). Tests exercise local code and will not catch a stale-function deploy;
  the smoke script does.
- Migrations: `./scripts/with-secrets.sh npx supabase db push`
  (`--include-all` for out-of-order files). Every schema change is a committed
  migration file — no one-off dashboard SQL.

## Repo conventions

- This is a **Vite** app, not Next.js. Ignore any "use client" suggestions.
- Feature work goes on `feat/*` branches with preview deploys; only `main`
  deploys to prod, and only after review/merge.
- Migrations: `supabase/migrations/2026MMDD000000_<name>.sql`, idempotent
  (`IF NOT EXISTS` / `DROP … IF EXISTS`), each with a one-line rollback comment.
