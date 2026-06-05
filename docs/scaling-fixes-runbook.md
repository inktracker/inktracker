# Scaling fixes — what changed and how to ship it

Two fixes from `docs/scaling-weak-points.md`: the database indexes (#2) and the
supplier-lookup cache (#1). Nothing is deployed yet — these are code/migration
changes in the repo, ready for you to review and ship through your normal
pipeline. Below is exactly what changed, the deploy order, and the safety valve.

## What changed

**#2 — Indexes** (`supabase/migrations/20260621000000_core_table_indexes.sql`)
Adds indexes on the columns every list page filters and sorts by
(`shop_owner` + `created_at`/`date`, plus `customer_id` / `customer_name`) for
quotes, orders, invoices, and customers. Pure performance — every statement is
`CREATE INDEX IF NOT EXISTS`, so it changes query speed only, never behavior or
data. Safe to run multiple times.

**#1 — Supplier lookup cache**
- New table: `supabase/migrations/20260621000100_supplier_style_cache.sql`
- New helper: `supabase/functions/_shared/supplierCache.ts`
- Wired into: `ssLookupStyle` and `acLookupStyle`

How it behaves: the **public quote wizard** (the only caller that passes a
`shopOwner`) now checks a per-shop cache before calling S&S / AS Colour. A repeat
lookup of the same style returns instantly instead of making the full set of live
supplier calls. Your **in-app** screens (quote editor, broker editor, the
WizardConfigEditor "Sync from suppliers" button) pass an Authorization header and
no `shopOwner`, so they are never cached — they always hit live suppliers.

Why it can't leak pricing: the cache key includes `shop_owner`, and prices /
inventory are resolved with each shop's own supplier credentials, so one shop is
never served another shop's payload.

Why it can't take the wizard down: every cache read and write is **fail-open** —
if the cache table is missing or the DB hiccups, the code silently falls through
to the live lookup exactly as before.

What it does NOT cache: errors, empty results, the `rawSkus` (order-time) path,
and any `debug` request. Only clean, successful, non-empty results are stored.

## Deploy order (important)

The migration must land **before** the functions, so the table exists when the
functions first try to use it. (Even if you do it out of order, fail-open means
nothing breaks — it just won't cache until the table is there.)

1. Apply the migrations:
   ```
   npx supabase db push
   ```
2. Deploy the two functions (they're already in your `deploy:functions` set):
   ```
   npx supabase functions deploy ssLookupStyle --no-verify-jwt
   npx supabase functions deploy acLookupStyle --no-verify-jwt
   ```
   Or just run your normal `npm run deploy`, which redeploys these with the
   audit + smoke gates and ships the frontend. (No frontend changed here, but
   running the full pipeline is fine and keeps the gates honest.)

## The kill switch

Caching is controlled by one Supabase env var, `SUPPLIER_CACHE_TTL_SECONDS`:

- unset → default **3600** (1 hour)
- a number → that many seconds of freshness
- **`0` → cache fully disabled**, behavior reverts exactly to today

If anything ever looks off, turn it off instantly without redeploying code:
```
npx supabase secrets set SUPPLIER_CACHE_TTL_SECONDS=0
```

## A note on freshness

The cached payload includes inventory counts, which can move during the hour.
For a *quote* wizard that's fine — quotes are estimates, and the real order path
(`ssPlaceOrder` / `acPlaceOrder`) and the order-time `rawSkus` lookup are never
cached, so committing stock always uses live data. If you'd rather trade some
speed for fresher inventory, lower the TTL (e.g. `SUPPLIER_CACHE_TTL_SECONDS=900`
for 15 minutes).

## Tests

- `supabase/functions/_shared/__tests__/supplierCache.test.ts` covers the key
  builder and the TTL/kill-switch parsing. Run with:
  `deno test supabase/functions/_shared/__tests__/supplierCache.test.ts`
- The existing JS suite (`npm test`) is unaffected — these changes are all in
  edge functions, which aren't part of that test graph.
