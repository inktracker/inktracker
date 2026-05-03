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
| Per-shop pricing config | `src/lib/pricingConfig.js` |
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
| `shopifySync` / `shopifyOAuthCallback` | Shopify inventory integration |
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
- When changing pricing logic, update ALL locations that display/calculate prices

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
