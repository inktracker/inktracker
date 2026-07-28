# Scope: real QuickBooks discount line

**Status:** scoped, not started
**Goal:** a discounted invoice shows `SUBTOTAL / Discount −$90.00 / TOTAL` in
QuickBooks, with clean per-line rates, instead of spreading the discount into
every line's Amount and appending `(less $90.00 discount)` to each description.

## Today's behavior

`buildInvoiceLinesFromPayload` (`supabase/functions/_shared/qbInvoice.js:587`)
subtracts each garment line's pro-rata share of the discount from its `Amount`,
recomputes `UnitPrice = Amount / Qty` to 4dp, and appends a discount note to the
description. Fees (`_isFee`) are excluded from the spread, mirroring
`calcQuoteTotals` where setup + fees are added post-discount.

Two consequences on a live invoice (INV-2026-F93AM, Choo Choo's Tavern):

1. Rates render as `15.2542`, `19.492`, `10.1692` instead of the real sell price.
2. `discountLabel` is built once from the **total** discount and appended to
   **every** line, so a single $90 discount reads as `(less $90.00 discount)`
   three times — $270 to anyone reading the invoice. The label is wrong on any
   multi-line invoice; only the amounts are right.

The comment at line 584 gives the original rationale: a `DiscountLineDetail` is
applied by QB *before* tax, so spreading inline was the way to make QB tax the
discounted total.

## Why this is not a one-line swap

The blocker is the tax reconciliation contract, not the discount math.

`reconcileQbInvoice` (`supabase/functions/_shared/qbWriteContracts.js:102`)
compares what we sent against what QB stored:

- `sumQbLineAmounts` (line 28) skips any line whose `DetailType !== "SalesItemLineDetail"`,
  so a discount line is excluded from both `sentSubtotal` and `qbSubtotal`.
  Good news: **no `lineAmountDrift` / DRIFT integrity alarm.**
- But `sentTotal = sentSubtotal + sentTax` would then be the **pre-discount**
  total, while `qbTotal = qbResponse.TotalAmt` is **post-discount**. So
  `totalDrift = −discount` on every discounted invoice.
- A non-zero `totalDrift` with faithful lines classifies as `TAX_MISMATCH`
  (line 163). That is the state that puts invoices **on hold** and fires the
  `qb_tax_mismatch` notification (18 rows in prod, most recent 2026-07-22).

So the naive change makes **every discounted invoice land on hold**. That is the
regression to design against — not the discount rendering itself.

Second unknown, which must be settled empirically rather than assumed: with
Automated Sales Tax (`TxnTaxDetail: {}`, `qbSync/index.ts:1669`), does QBO
compute tax on the pre- or post-discount subtotal? QB's global preference is
"Discount applied before/after sales tax", and AST may or may not honor it via
the API. The tax-exempt invoice in the screenshot ($0.00 tax) would not have
exposed this either way.

## Work items

### 1. Emit the discount line
`buildInvoiceLinesFromPayload` gains a discount-line mode: leave garment
`Amount` / `UnitPrice` untouched, append one

```js
{ DetailType: "DiscountLineDetail",
  Amount: discountTotal,
  Description: discountDescription || "Discount",
  DiscountLineDetail: { PercentBased: false, DiscountAccountRef: { value: <id> } } }
```

Keep the fee-exclusion rule: the discount still applies to garment lines only,
so `discountTotal` is still computed off the non-fee subtotal. Prefer
`PercentBased: false` with an explicit amount even for percent discounts, so the
number InkTracker shows and the number QB shows can never drift apart.

Carry `discount_description` (already a column on `invoices` and `quotes`, shipped
in #596/#597) into the line description — the shop already types a reason.

### 2. Pick the discount account
`DiscountAccountRef` needs an income account. `NON_SALES_INCOME_NAMES`
(`qbInvoice.js:27`) already lists `"discounts given"` as an account we
deliberately avoid for *product revenue* — for the discount line it is exactly
the right target. Resolve it the same way the income account is resolved today;
fall back to letting QB pick its default when the shop has no such account.
Do **not** post discounts to the shop's sales account.

### 3. Teach reconcileQbInvoice about discounts
This is the core change. `reconcileQbInvoice` must receive the discount amount
and subtract it when computing `sentTotal`, so `totalDrift` stays ~0 on a
correctly-priced discounted invoice and `TAX_MISMATCH` keeps meaning what it
means today. Add `sentDiscount` to its input contract and thread it from the
call site. Without this, item 1 is a regression regardless of how it renders.

### 4. Settle the AST tax question empirically
Create a discounted, **taxable** invoice in the Biota realm against a taxable
ship-to (not the tax-exempt customer) and compare `TxnTaxDetail.TotalTax` against
tax computed on the post-discount subtotal.

- If AST taxes post-discount: the original rationale is obsolete and the change
  is clean.
- If AST taxes pre-discount: the customer would be over-taxed relative to the
  quote. Then either keep the inline spread for taxable invoices and use a real
  discount line only for tax-exempt ones, or accept QB's tax as authoritative
  (which it already is) and adopt it onto the quote via the existing hold →
  adopt path. **This is the decision gate — do not ship past it.**

### 5. Import path
`pullInvoices` reads QB invoices back. `sumQbLineAmounts` already skips
non-`SalesItemLineDetail` lines, so the discount line will not be mistaken for a
garment line, but confirm the imported `line_items` render and that the local
`discount` / `discount_type` fields get populated from it rather than silently
dropped.

### 6. Keep the legacy stripper
`QB_DISCOUNT_NOTE_RE` / `stripQbDiscountNote` (`qbInvoice.js:759`) must stay —
every invoice already in QB carries the old `(less $X discount)` notes, and
`pullInvoices` still needs to strip them on re-import. New writes stop producing
them; old rows keep needing the cleanup.

### 7. Tests
- `buildInvoiceLinesFromPayload`: discount line emitted once, garment `Amount`
  and `UnitPrice` unmodified, fees excluded from the basis, percent and flat both
  resolving to the same explicit amount.
- `reconcileQbInvoice`: a discounted invoice reconciles to `OK`, not
  `TAX_MISMATCH` — the regression test that matters most.
- Round-trip: build → simulated QB response with a discount line → reconcile →
  no hold.

## Not in scope

- Reformatting invoices already in QuickBooks. Existing invoices keep their
  embedded discounts; this changes new writes only.
- The customer-facing InkTracker PDF, which already itemizes the discount
  correctly (`InvoiceDetailModal.jsx:666`).

## Cheap alternative if #4 goes badly

Fix the label only: build the per-line share into `discountLabel` inside the
`forEach` instead of once outside it, so each line reads its own pro-rated
amount. No tax risk, no reconciliation change, and it removes the "$270 of
discounts" misreading. Rates stay ugly.
