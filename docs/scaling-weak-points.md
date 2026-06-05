# InkTracker — Scaling Weak Points

Found by reading the code on 2026-06-03. This is a *static* audit — where the app
will bog down under load, identified by inspection rather than by running traffic.
Ranked by how likely each is to bite first. No action required from you to produce
this; fixes are noted so you can decide what's worth doing.

How to read "when it bites": InkTracker is multi-tenant — every shop's quotes,
orders, and invoices share the same database tables. So "load" is both *many shops*
and *each shop accumulating years of records*. The two stack up.

---

## 1. Supplier API calls sit in the request path, with no result cache — HIGH

**What happens:** Every time a shopper picks a garment in the public quote wizard,
`ssLookupStyle` / `acLookupStyle` make *live* calls to S&S Activewear and AS Colour
(several HTTP round-trips each). Nothing is cached. Ten shoppers looking up the same
popular style = ten full round-trips to the supplier.

**Why it's your #1 ceiling:** Your throughput is capped by *the suppliers'* speed and
rate limits, not your own servers. If S&S is slow or briefly down, your wizard is slow
or down — for everyone, during the exact moment a customer is trying to buy. You already
added a per-shop rate limiter (good — stops abuse), but that protects the supplier, it
doesn't make *you* faster.

**When it bites:** As soon as you have real concurrent wizard traffic — a launch, a
viral post, a busy shop's customers all configuring at once.

**Fix:** Cache style lookups. Garment specs barely change, so a 24-hour cache (in
Postgres or Supabase's edge cache) turns the 11th lookup of a style into an instant
local hit. This is the single highest-value change and also makes you resilient to
supplier outages. Moderate effort, big payoff.

---

## 2. Missing database indexes on the columns you filter and sort by — HIGH

**What happens:** Almost every page runs "give me this shop's rows, newest first" —
e.g. `quotes WHERE shop_owner = ? ORDER BY created_at`. The core tables (quotes, orders,
invoices, customers) have **no index on `shop_owner` + `created_at`**, and the Customers
page looks rows up by `customer_id` / `customer_name`, which also aren't indexed. Indexes
exist for newer side tables (notifications, purchase orders, QB logs) but not the hot path.

**Why it matters:** Without an index, Postgres scans the *whole* table and sorts the
results every time. With one shop and 50 quotes that's invisible. With 100 shops and
years of shared history in one table, every dashboard load gets slower — for everyone,
because they share the table.

**When it bites:** Gradually, then suddenly — fine through your Founding 50, painful once
the tables are large.

**Fix:** Add composite indexes: `(shop_owner, created_at desc)` on quotes/orders/invoices,
and indexes on `customers(customer_id)` / `(customer_name)`. This is a small, low-risk
migration — minutes of work, no code change. Probably the best effort-to-payoff ratio here.

---

## 3. Pages load up to 500–1000 full rows (with big JSON) on every visit — MEDIUM

**What happens:** The data layer does `SELECT *` and the pages pull large batches —
Quotes loads 500, Invoices/Performance load 1000, Production loads orders + quotes +
customers + purchase orders all at once. Quotes and orders carry fat JSON blobs
(`line_items`, `imprints`, `saved_imprints`), so "500 rows" can be megabytes over the wire,
re-fetched on every page open.

**Why it matters:** Heavy payloads slow the page for the user *and* put steady load on the
database and bandwidth. It compounds with #2 (no index = slow scan *and* big result).

**When it bites:** Once a single shop has hundreds of quotes/orders — the busy shops, i.e.
your best customers.

**Fix:** Paginate (load 25–50 at a time) and select only the columns a list view needs
instead of `SELECT *`. Bigger lift than #1/#2 because it touches several pages, so do it
after the quick wins.

---

## 4. Postgres connection limits under concurrency — MEDIUM

**What happens:** Serverless functions + a burst of concurrent quote inserts/reads can
open more database connections than Postgres allows, causing "too many connections" errors
under load — the classic serverless + Postgres wall.

**When it bites:** Traffic spikes, not steady use. This is the thing a load test would
surface first.

**Fix:** Make sure every server-side path uses Supabase's *pooled* connection (PgBouncer /
the pooler port), not a direct connection. Mostly a config check, but important to verify
before any real spike. Worth confirming explicitly.

---

## 5. N+1 query pattern on the Customers page — LOW/MEDIUM

**What happens:** Opening a customer fires ~6 separate queries (quotes, orders, invoices by
id and by name); the duplicate-merge flow does this *inside a loop* over duplicates, so the
query count multiplies with the number of duplicates.

**When it bites:** Bulk customer cleanup / merge operations on shops with many customers.

**Fix:** Batch these into fewer queries. Low urgency unless you see the Customers page lag.

---

## 6. `dailyStats` sums rows in JavaScript instead of in SQL — LOW

**What happens:** The morning-briefing function pulls every quote/invoice row in the time
window and adds them up in code, rather than asking Postgres for a `SUM`.

**When it bites:** Far out — only once daily/weekly volume is large. Bounded by the time
window, so not urgent.

**Fix:** Use SQL aggregates (`SELECT sum(total) ...`) or a small RPC. Easy, low priority.

---

## Side findings (not scaling, but found while looking)

- **Tenant isolation leans on app code, not the database.** The authenticated RLS policy is
  `USING (TRUE)` and `anon_select_quotes` is `USING (TRUE)` — meaning the database itself
  doesn't enforce "you can only see your own shop's rows"; the `.filter({shop_owner})` calls
  in the app do. That works until one query forgets the filter. Worth a real RLS pass before
  you scale the customer base. (Security, not performance — but high-stakes.)
- **Likely dead query:** `emailScanner` filters on `.gte("created_date", ...)`, but the column
  is `created_at`. That filter probably errors or matches nothing. Quick bug to verify.

---

## What this means for load testing

The k6 suite in `loadtest/` is still the way to *measure* these once you want hard numbers,
but the audit already tells us **what** to point it at: the supplier-lookup path (#1) and
concurrent writes against the connection pool (#4). Those are the two that will break first.

Honest take, given your stage: fixing #1 and #2 is higher-value than running load tests
right now. They're concrete, low-risk, and you don't need to reproduce load to justify them —
they're correct regardless. Measure later, once you have paying shops actually generating
the traffic.
