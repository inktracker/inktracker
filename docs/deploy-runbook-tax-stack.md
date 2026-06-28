# Deploy Runbook — Multi-State Tax Stack (PRs #451–#455)

Operational steps to ship the multi-state sales-tax work. See
`docs/qb-multistate-tax-scope.md` for the design.

## What's in the stack

| PR | Migration | Edge fn | Frontend |
|----|-----------|---------|----------|
| #451 Phase 0 | `20260718000000_invoices_qb_reconciliation_cols.sql` | qbSync | yes |
| #452 Phase 1 | `20260719000000_customers_ship_to_address.sql` | qbSync | yes |
| #453 Phase 2 | `20260720000000_customers_exemption_certificate.sql` | qbSync | yes |
| #454 Phase 3 | `20260721000000_tax_records.sql` | qbSync | yes |
| #455 Phase 4 | — | — | yes |

Only **one** edge function changed across the whole stack (`qbSync`), plus
**4 additive migrations** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT
EXISTS` — they never drop or alter existing data).

## Order is the whole game

`qbSync` writes to the new columns/table. **Deploy `qbSync` before the
migrations and those writes fail** (missing column/table). So:
**migrations → qbSync → frontend.**

---

## Step 1 — Merge the stack (in order)

```
#451 → #452 → #453 → #454 → #455
```

Merge #451 first; each stacked PR's base auto-retargets to `main` as the prior
merges. Confirm CI is green on `main` after the final merge.

## Step 2 — Apply migrations (FIRST)

From a clean `main` checkout with the Supabase CLI linked:

```bash
# one-time, if not already linked:
npx supabase link --project-ref skmltfbibaqcjddmeqvi

# applies all 4 pending migrations in timestamp order:
npx supabase db push
```

Confirm it applies `20260718…` through `20260721…`. Idempotent — safe to re-run.

## Step 3 — Deploy `qbSync` (the only changed function)

```bash
~/.deno/bin/deno check supabase/functions/qbSync/index.ts   # gate: must be clean
npx supabase functions deploy qbSync --no-verify-jwt
```

`--no-verify-jwt` is required (auth is handled inside the function). **Do not**
rely on `npm run deploy` — that script only deploys the wizard functions
(`ssLookupStyle` / `acLookupStyle` / `createQuoteFromPayload`), not `qbSync`.

## Step 4 — Deploy the frontend

```bash
npm run test          # vitest + eslint — must be green
vercel --prod --yes
```

---

## Step 5 — Smoke test (on a real invoice)

1. **Test customer** with a structured **ship-to (state + ZIP)** — Customers → edit → Ship-To Address.
2. **Send a quote → create the QB invoice.** Verify:
   - Tax matches the quote → **no "on hold"** banner (Phase 0/1 working).
   - In QuickBooks the invoice's **ShipAddr shows city/state/ZIP** (not one line).
3. **Exemption:** mark a customer exempt with an **expired** cert date → create an invoice → it should **collect tax** and surface the hold (Phase 2 enforcement).
4. **Audit + report:** Performance → **Sales Tax Collected by State** shows the invoice; **Summary** + **Detail** CSVs download (Phase 3/4).
5. **DB:** `tax_records` has a row for the test invoice with `ship_to_state` populated.

## Step 6 — Backfill history (optional)

`tax_records` populates going forward. To populate **existing** invoices so the
report shows history immediately, run the backfill — it re-pulls each shop's QB
invoices and writes a record per invoice (the in-app **QB → Refresh** button now
does the same):

```bash
node scripts/backfill-tax-records.mjs        # see the script header for auth/usage
```

## Rollback

- **Migrations:** additive — nothing to roll back; leaving the columns/table is harmless.
- **qbSync:** `git revert` the merge on `main` → redeploy `qbSync --no-verify-jwt`.
- **Frontend:** `vercel rollback` to the previous production deployment (instant).

## Notes / gotchas

- **Nothing in Phase 0 fires today** — current shop rates match QB, so the hold
  is a dormant tripwire. Not seeing it on the first invoice is correct.
- **For Kato:** after deploy his customers still need **state + ZIP** filled in
  (new ship-to fields, "Fill from address", or directly in QB) before AST
  sources correctly — the code fix alone doesn't backfill addresses.
