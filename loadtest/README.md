# Load testing InkTracker with k6

Free, local load testing. No account, no cloud bill — k6 runs on your Mac and
prints results to the terminal. Optionally streams to Grafana later.

## The one rule

**Never load test production.** InkTracker's "whole app" includes parts that
place real supplier orders, charge real cards, and email real customers. A load
test against the live site would create real orders, burn S&S / AS Colour and
email credits, and fill your database with junk quotes.

So load testing "the whole thing" means: **stand up a complete local copy and
throw traffic at the copy.** Same code, same DB schema, same functions — just
isolated, with the outside services (S&S, AS Colour, Stripe, QuickBooks) faked
or in test mode so nothing real happens.

The scripts here enforce this: `quote-wizard.js` refuses to run unless the
target is `localhost` (the guard lives in `config.js`).

## Install k6

```
brew install k6
```

## What each test does

| Script | What it hits | Safe on prod? |
|--------|--------------|---------------|
| `smoke.js` | 1 user, loads `/`, `/QuoteRequest`, `/login` once. Run first. | Yes (GET only) |
| `frontend.js` | Ramps to 50 users loading the SPA pages. Models a launch-day traffic spike on the CDN. | Yes (GET only) |
| `quote-wizard.js` | Ramps to 20 users hitting the supplier style-lookup functions — the real bottleneck. | **No — local/staging only** |

## Quick start (frontend only — totally safe)

In one terminal, run the app:

```
npm run dev
```

In another:

```
k6 run loadtest/smoke.js        # sanity check first
k6 run loadtest/frontend.js     # then the real load
```

You can also point the frontend test at prod (read-only) to see how the CDN
holds up — that's safe because it's GETs only:

```
BASE_URL=https://inktracker.app k6 run loadtest/frontend.js
```

## Full money-path test (local stack)

This exercises the edge functions the quote wizard depends on. You need a local
Supabase running so the functions exist locally and nothing touches prod.

1. **Start local Supabase** (needs Docker Desktop running):

   ```
   npx supabase start
   ```

   It prints a local API URL (`http://localhost:54321`) and an **anon key** —
   copy that key.

2. **Stub the supplier APIs.** `ssLookupStyle` / `acLookupStyle` call S&S and
   AS Colour. For a load test you don't want real outbound calls, so either:
   - point their credentials at the suppliers' sandbox/test endpoints, or
   - set the per-shop supplier creds on your local `profiles` row to a local
     mock server (e.g. a tiny `http://localhost:8787` that returns canned JSON).

   The point is to measure *your* function + DB throughput, not the suppliers'.

3. **Run the test** with the local anon key:

   ```
   ANON_KEY=<anon-key-from-step-1> k6 run loadtest/quote-wizard.js
   ```

   If you try to run it against a non-local URL it will abort on purpose. To
   override for a real staging project (Stripe/QB/email in test mode!):

   ```
   ALLOW_NONLOCAL=1 SUPABASE_URL=https://staging-ref.supabase.co \
     ANON_KEY=<staging-anon> k6 run loadtest/quote-wizard.js
   ```

## Reading the results

k6 prints a summary. The numbers that matter:

- **`http_req_failed`** — your error rate. Thresholds fail the run if it climbs
  above 1% (smoke test: must be 0%).
- **`http_req_duration` p(95) / p(99)** — 95th/99th percentile response time.
  This is where you'll see the wall: latency stays flat, then hockey-sticks once
  you exceed Postgres connection limits or a function's concurrency.
- **`checks`** — % of assertions that passed (e.g. "not auth-blocked").

A green run means every threshold held. A red run tells you the breaking point —
note the VU count where p95 spiked; that's roughly your current ceiling.

## Tuning

Edit the `stages` array in each script to model your real expected load. Start
small (the defaults here are deliberately gentle) and raise the `target` VU
counts until something breaks. The first thing to break on a serverless +
Postgres stack is almost always the database connection pool — if you see errors
there, look at Supabase's pooler (PgBouncer) settings before blaming the code.

## Later: stream results into Grafana

k6 can push live metrics to a dashboard:

```
k6 run --out experimental-prometheus-rw loadtest/frontend.js
```

That ties back into the Grafana setup — same tool family, so the load-test
graphs live next to your uptime and business dashboards.
