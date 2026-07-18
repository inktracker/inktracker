# Total Volume (incl. QB history) — scope

**Status:** SPEC — not built. Requested by Joe 2026-07-18 after the Units Sold
fixes (#646–#648) surfaced that QB-imported invoices with no production order
never appear in Units Sold.

## The question the card answers

"How many pieces has my shop moved in this period?" — regardless of whether
the job ran through InkTracker production or exists only as a QuickBooks
invoice (imported history, QB-first jobs never bridged to the schedule).

This is deliberately a different question from **Units Sold**, which stays
as-is: pieces through *completed production orders* (the operational stat).
Total Volume is the business-history stat. Two cards, two honest answers.

## Why it matters (real numbers, Biota, 2026-07-18)

| Source | Count | Units |
|---|---|---|
| Completed production orders (all time) | 25 | 1,846 |
| QB-only invoices (no linked order) | 643 | ~152,966 |

The pre-InkTracker history is ~80× the production-tracked era. Any "how big
is my shop" question is dominated by data only this card would surface.

## Universe & dedup (the correctness core)

`Total Volume = units(completed orders in period) + units(QB-only invoices in period)`

An invoice is **QB-only** iff BOTH:
1. `invoice.order_id` is null OR points at a deleted order, AND
2. no quote exists with `quote_id = invoice.invoice_id` having a
   `converted_order_id` (quote-born invoices often have `order_id = null`;
   the quote carries the order pointer — checking only (1) double-counts
   every quote-born job).

Covers all three birth paths: quote-born (counted via order), Add to
Production (invoice.order_id set → counted via order), QB-import (counted
via invoice). An invoice bridged via Add to Production **moves** from the
invoice bucket to the order bucket — total stays continuous.

## Date attribution

- Orders: `completed_date` (production truth; matches Units Sold).
- Invoices: `date` (QB TxnDate = billed date).

Mixed semantics (produced vs billed) are acceptable and documented in the
card tooltip. No invoice has a completion concept; billed date is its only
honest anchor.

## Units per line

Same rule as `getQty`/RPC v2.2 (#648): sizes-sum when the sizes map has any
key, else bare `qty`. PLUS a fee-line exclusion for invoice-side lines:
QB stub lines include "Estimated Shipping", "Setup Fee" etc. at qty 1–N that
are not garments. Exclude lines whose `style` matches
`/(shipping|setup|fee|rush|discount|surcharge)/i`.

- Measured impact on Biota: 152,966 → 152,135 (−831, ~0.5%) — small but the
  exclusions are categorically correct, not noise-trimming.
- Heuristic risk: a real garment named "Rush Tee" would be excluded. Accepted;
  patterns documented in code, revisit only on a real complaint.
- Order-side lines get NO exclusion (production lines are garments by
  construction; imported Add-to-Production orders inherit invoice lines, so
  apply the same exclusion there — keyed off line id prefix `qb-`).

## Surfaces

1. **Performance page**: new card next to Units Sold.
   - Label: "Total Volume" / sub: "{orders} orders + {invoices} QB invoices".
   - Tooltip: "All pieces billed in this period — completed production orders
     plus QuickBooks invoices that never became production orders. Units Sold
     counts only production orders."
2. **RPC**: `performance_stats` v3 adds `period_total_volume`,
   `period_qb_only_invoice_count`. Same SECURITY INVOKER + REVOKE pattern
   (keep the contract tests' REVOKE assertion satisfied — v2.1 lesson).
3. **Client fallback** in Performance.jsx mirrors the SQL exactly; invoices
   are already loaded on the page (capped 1000 — cap noted below).

## Known limits (state in tooltip/docs, don't solve now)

- Client fallback caps at 1000 invoices (Biota has 664 total; revisit at cap).
  RPC path is exact and is the primary source.
- Deleted-in-QB invoices keep their imported row (missing_in_qb signals
  exist but don't delete); their units keep counting. Consistent with
  "history" framing.
- QB invoices with quantity expressed only in the description (rare hand-typed
  lines, qty left at 1) undercount. QB is the limit of knowability here.

## Explicit non-goals

- No change to Units Sold, AOV, or Gross Sales (all stay production-scoped;
  QB is already the authority for dollars via the QB-sourced cards).
- No gross-$ union card: dollars from QB-only invoices are already inside the
  QB Total Sales card — a union $ card would double-represent.
- No backfill/bridging automation: Add to Production remains the explicit way
  to promote a QB invoice into production stats.

## Build estimate

Migration (RPC v3) + card + client math + tests ≈ half a day. No edge-function
deploy (RPC + frontend only). Deploy order: migration → Vercel.
