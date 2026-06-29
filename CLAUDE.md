# InkTracker

Print shop management SaaS. Multi-tenant — each shop owner's data is isolated via Supabase RLS.

## Stack

- **Frontend:** React 18, Vite, React Router v6, Tailwind CSS, Radix UI
- **Auth/Data:** Supabase (auth, Postgres, edge functions, storage). Data accessed via `base44.entities.*` wrapper
- **Edge Functions:** Deno, in `supabase/functions/`
- **Deployment:** Vercel (deploy with `npx vercel --prod`)
- **Domain:** inktracker.app
- **Email:** Resend API (sends from quotes@inktracker.app)
- **Payments:** Stripe (subscription billing + customer quote payments)
- **Accounting:** QuickBooks Online (two-way sync)
- **Suppliers:** S&S Activewear API, AS Colour API (live garment pricing/inventory)

## Billing

Single plan: $99/mo "Shop" tier. 14-day free trial. All features included.
- Stripe price ID: `price_1TR50AI4m9BGT2cwXUsKF6Ul`
- Billing logic: `src/lib/billing.js`, `supabase/functions/billing/`, `supabase/functions/billingWebhook/`
- Trial activated via `activate_trial` SECURITY DEFINER RPC function

## Key Files

| Area | Path |
|------|------|
| Main app + landing page | `src/App.jsx` |
| Auth context | `src/lib/AuthContext.jsx` |
| Layout + sidebar nav | `src/Layout.jsx` |
| Pricing engine | `src/components/shared/pricing.jsx` |
| Billing/feature gating | `src/lib/billing.js` |
| Onboarding wizard | `src/components/OnboardingWizard.jsx` |
| Quote line item editor | `src/components/quotes/LineItemEditor.jsx` |
| Order wizard (public) | `src/components/wizard/OrderWizard.jsx` |
| Supabase client | `src/api/supabaseClient.js` |

## Pages

Dashboard, Quotes, Production, Orders, Customers, Inventory, Invoices, Expenses, Performance, Mockups, Wizard, Embed, Account, AdminPanel, ShopFloor, BrokerDashboard, QuotePayment, QuoteRequest, ArtApproval, Calendar, Catalog

## Edge Functions

| Function | Purpose |
|----------|---------|
| `billing` | Stripe subscription checkout, portal, trial activation |
| `billingWebhook` | Stripe webhook for subscription events |
| `createCheckoutSession` | Customer quote payment via Stripe |
| `stripeWebhook` | Customer payment webhook |
| `sendQuoteEmail` | Send quote emails via Resend |
| `qbSync` | QuickBooks: invoices, expenses, reports, connection check |
| `qbOAuthCallback` | QuickBooks OAuth flow |
| `qbWebhook` | QuickBooks webhook handler |
| `ssLookupStyle` / `ssSearchCatalog` / `ssPlaceOrder` | S&S Activewear API |
| `acLookupStyle` / `acSearchCatalog` / `acGetInventory` / `acGetPriceList` | AS Colour API |
| `adminAction` | User management (invite, delete, list) |
| `createQuoteFromPayload` | Create quote from wizard submission |
| `_shared/ascolour.ts` | Shared AS Colour auth helpers |

All edge functions have `verify_jwt = false` in `supabase/config.toml` (auth handled internally).

## Multi-Tenancy

- RLS on all 18 tables, scoped by `shop_owner` (email)
- Profiles table uses flat single policy (no self-referencing subqueries — causes infinite recursion)
- Quotes/orders have anon insert/select/update for public wizard
- Broker/manager access via `assigned_shops` JSONB lookup
- `activate_trial` is a SECURITY DEFINER function (bypasses RLS)

## Pricing Engine

- Module-level `_pc` variable loaded on auth from `shops.pricing_config` JSONB
- Supports screen print (color-count tiers) and embroidery (stitch-count tiers)
- `loadShopPricingConfig()` called in AuthContext after login
- **Also called in `QuoteRequest.jsx`** for the anonymous public wizard — without this hydration step, the wizard runs on platform defaults and the shop's embroidery / DTF / per-color pricing won't appear.
- When changing pricing logic, update ALL locations that display/calculate prices

## Public Wizard — Required Pre-Deploy Gates

The "wizard total missing the blank cost" bug class has shipped twice. Three gates now guard against it. Any change to the files below MUST pass all three before `npm run deploy` (which is gated by `predeploy`):

**Trigger files** — `OrderWizard.jsx`, `WizardConfigEditor.jsx`, `src/lib/wizard/*`, `src/components/shared/pricing.jsx`, `QuoteRequest.jsx`, `ssLookupStyle`, `acLookupStyle`, anything reading/writing `wizard_styles[]`.

1. **`npm test`** — unit + contract tests. Covers data-shape (`isStyleEnriched`), function behavior (`getEffectiveCost` imported directly, not inlined), and the round-trip via `calcQuoteTotalsWithLinking`.
2. **Render-path tests** (run by `npm test`) — `src/lib/wizard/__tests__/wizardRenderPath.test.js` walks the actual call graph the public wizard uses. Catches "function reads data correctly but downstream math drops it."
3. **`npm run audit:wizard`** — connects to prod via service-role key, flags any shop's `wizard_styles[]` row missing `garmentCost` / `priceMap`. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars. Exits non-zero on stale data.

`npm run predeploy` runs both `test` and `audit:wizard`. `npm run deploy` chains `deploy:functions` → `smoke:functions` → `vercel --prod --yes` and is the canonical deploy path. Do not deploy with `npx vercel --prod` directly when touching wizard/pricing code — that bypasses the audit AND the edge-function deploy / smoke gates.

**Edge functions are a SEPARATE deploy target.** Vercel ships the frontend; Supabase ships the edge functions. `npm run deploy:functions` re-deploys ssLookupStyle, acLookupStyle, and createQuoteFromPayload with `--no-verify-jwt` (required so the anonymous public wizard can call them). `npm run smoke:functions` pings each one with the exact payload the wizard sends and refuses to proceed if either returns a JWT/auth rejection. This pair caught the "frontend shipped on stale edge functions" pattern that bit us twice. Never short-circuit it.

When you change ANY file under `supabase/functions/*`, the change is invisible to production until `npx supabase functions deploy <name>` runs. Tests don't catch this — they exercise local code. The smoke script does.

**When writing new wizard/pricing tests:** always import the real function (e.g. `import { getEffectiveCost } from "@/lib/wizard/getEffectiveCost"`). Never inline a copy — they drift silently and let bugs through. The first contract test inlined `getEffectiveCost` and the real function shipped a string-coercion bug the test couldn't see.

## User Roles

- `shop` / `admin` — full access, admin panel
- `manager` — full shop access, no billing/admin
- `employee` — shop floor only
- `broker` — broker dashboard only, scoped by `assigned_shops`
- `user` — pre-activation (auto-upgrades to shop via trial RPC)

## Important Patterns

- This is a **Vite** app, NOT Next.js. Ignore "use client" suggestions from hooks.
- Data fetching uses `base44.entities.EntityName.filter()` / `.list()` / `.create()` / `.update()`
- Auth: `base44.auth.me()` returns current user profile
- Supabase edge function calls: `fetch(SUPABASE_FUNC_URL + "/functions/v1/functionName", ...)`
- Email sends FROM verified domain (inktracker.app) with Reply-To set to shop owner
- Per-shop supplier API credentials stored on profiles table
- Always verify DB columns exist before adding fields to insert/update payloads
