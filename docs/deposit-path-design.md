# Deposit Path — Design (2026-08-12)

Deposits become collectible. The driving user is Kato (thunder-house), who
today collects 50% up front by **halving his QB invoices by hand** — the
single largest recurring source of books-drift alerts (Q-2026-9Q31,
$1,745.57 standing). This design automates his exact workflow with books
that foot, on the QB rails his customers already pay through.

## Why not the obvious alternatives

- **QB pay link for "50% now"** — impossible. The Intuit share link always
  bills the invoice's current open balance; there is no partial-amount
  control in the API.
- **Invoice.Deposit field** — records money *already received*; it is not a
  collection mechanism, and we never hold customer funds.
- **Stripe deposit checkout** — the code exists (dormant since PR #201) but
  requires every shop to onboard Stripe Connect and contradicts the standing
  launch decision that QB is the sole customer-payment path. Deferred, not
  chosen. (The dormant path is left intact.)
- **Permanent two-invoice model (deposit invoice + credit line on final)** —
  books net correctly but the final QB invoice's TotalAmt becomes
  `full − deposit`, which diverges from the local as-sold total and would
  require teaching the drift scanner, qbStale, and the write-reconciliation
  contract about deposits. Rejected in favor of an end state the existing
  machinery already understands.

## The model: deposit invoice as a temporary collection vehicle

1. **Request** — quote has `deposit_pct > 0`. Sending the quote mints a
   small, real QB invoice: DocNumber `{quote_id}-DEP`, one NON-taxed line
   ("Deposit — {pct}% for {quote_id}"), amount = `round2(total × pct/100)`,
   snapshotted as `deposit_amount`. Its pay link is what the customer's
   "Approve & Pay Deposit $X" button opens. The full invoice does NOT exist
   yet.
2. **Collection** — customer pays the deposit invoice through the normal QB
   rail. qbWebhook matches `qb_deposit_invoice_id`, sets
   `deposit_paid + deposit_paid_at`, converts the quote to an order (a paid
   deposit IS the commitment), and emails the shop (event_type
   `deposit_payment`, deduped per quote).
3. **Settlement** — when the final (full) invoice is created in QB:
   - deposit invoice **paid** → move its Payment's LinkedTxn onto the final
     invoice, then void the (now zero-payment) deposit invoice. Order is
     move-first, void-second: every intermediate state is retryable and
     never loses the applied money.
   - deposit invoice **unpaid** → void it and notify the shop the deposit
     was never collected (balance due = full).
   - deposit marked paid **manually** (cash/check; no deposit invoice) →
     existing auto-post path: create a QB Payment for `deposit_amount`
     against the final invoice (now with idempotency key + clamp).
   End state in every branch: **one full invoice, TotalAmt = as-sold total,
   deposit applied as a linked Payment, Balance = remainder.** The pay link
   on the final invoice collects exactly the remainder.

## Why the end state matters

Everything already built keeps working untouched: the drift scanner
compares `total` vs `TotalAmt` (equal), `qbInvoiceHasPayment` guards
double-posts, balance-zero predicates decide paid, AST taxes the full
lines exactly once (deposit line is NON and gone by settlement), and the
tax-hold contract sees the same expected totals as today.

## Data

New columns (migration `20261012000000_deposit_path.sql`):

| table | column | why |
|---|---|---|
| quotes | `deposit_amount numeric` | dollar SNAPSHOT at request time — the agreement. Never re-derived; order edits change the remainder, never the deposit. |
| quotes | `deposit_paid_at timestamptz` | when collected |
| quotes | `qb_deposit_invoice_id text` | separate from `qb_invoice_id` so every scanner/reconciler keyed on `qb_invoice_id` ignores deposit invoices by construction |
| quotes | `qb_deposit_payment_link text` | validated like `qb_payment_link` (lockstep contract) |
| orders | `deposit_amount numeric` | carry-forward |
| invoices | `deposit_amount numeric`, `qb_deposit_invoice_id text` | settlement needs both at final-create |

CHECK `deposit_amount IS NULL OR deposit_amount >= 0` on all three.
`deposit_pct`/`deposit_paid` columns already exist everywhere (20260819).

## Audit hardening round (2026-08-12, five adversarial audits)

Findings fixed on top of the base design — the settlement mechanism held;
the pointer plumbing and several surfaces did not:

- **Builder parity (CRITICAL)**: the edge-side order builder
  (`buildOrderInsertFromQuote`) now carries all deposit fields; a parity
  test pins the frontend/edge builders together. Without it, every
  online-paid deposit lost its pointer at conversion and branch B posted a
  phantom Payment.
- **Duplication (CRITICAL)**: `QUOTE_DUPLICATE_EXCLUDED` strips
  `deposit_amount`, `deposit_paid_at`, and both deposit-invoice pointers.
- **Paid predicate**: `Approved && deposit_paid` no longer renders "Paid —
  Thank You!" — the balance is still owed.
- **Trust gate**: settlement refuses to move/void any QB document it
  can't prove is ours (`isTrustedDepositInvoice`: -DEP DocNumber family or
  our PrivateNote stamp) — a planted pointer can't void a real invoice.
  The employee column guard also covers `orders.qb_deposit_invoice_id`.
- **Identity-keyed clearing**: settlement clears pointers on quotes,
  orders, AND invoices by `qb_deposit_invoice_id` match, and stamps
  `deposit_paid` when settlement itself discovered the money (webhook
  miss).
- **VOID_UNPAID rules**: re-checks for in-flight payments before voiding;
  a locally-marked (cash) deposit posts the manual Payment instead of the
  false "never paid" email; ALREADY_GONE with a paid deposit alerts that
  the customer's money sits as an unapplied QB credit.
- **Relink clamp**: payments moved onto the final invoice are clamped to
  its open balance (over-collection becomes visible customer credit, not
  a wedged settlement loop).
- **Mint/final mutual exclusion**: `createDepositInvoice` shares the
  `create_invoice_row` lock with `createInvoice` and resolves the WHOLE
  quote→order→invoice chain before deciding `final_invoice_exists`.
- **Customer page**: deposit routing requires a live vehicle and no final
  invoice; either rail (deposit or final link) can collect; label follows
  routing.
- **Watchdogs**: nightly reconcile clears dead vehicles (voided in QBO)
  and notifies; alerts on deposits collected 30+ days with no final
  invoice; the pay-link format monitor scans `qb_deposit_payment_link`.
- **Anon hardening**: neither the wizard RPC nor `createQuoteFromPayload`
  accepts `deposit_paid` from the payload anymore; `quotes.deposit_pct`
  default drops 50 → 0.
- **Money display**: invoice PDF/email show "Deposit applied − $X /
  Balance due"; quote PDF shows "Deposit due now / Balance at completion";
  broker editors show read-only deposit terms only.

## Failure & race handling

- Mint fails → send proceeds without a deposit link; shop notified
  (`qb_deposit_invoice_failed`); customer button falls back to Approve-only.
- Move fails at settlement → nothing changed in QB; `qb_deposit_move_failed`
  notification; `settleDepositInvoice` is idempotent and re-runs on the next
  createInvoice call for the same doc.
- Void fails after move → money is safe on the final invoice; deposit
  invoice sits open/unpaid (AR overstated by X until retry); same
  notification + retry path.
- Customer pays deposit invoice AFTER settlement voided it → Intuit rejects
  payment on a voided invoice; if a webhook still arrives, the paid-lookup
  by `qb_deposit_invoice_id` runs `Balance` live-verification first.
- Webhook missed → qbReconcile nightly: quotes with `qb_deposit_invoice_id`
  and `deposit_paid = false` get a live Balance check (inside the existing
  25-live-check cap), then the same convert path.
- Order edited after deposit paid → `deposit_amount` is fixed;
  `orderEditWarnings` warns when the new total < deposit (over-collected).
- pullInvoices (Sync All) skips QB invoices whose Id matches any
  `qb_deposit_invoice_id` in-tenant or whose DocNumber ends `-DEP`.

## Out of scope (documented, deliberate)

- Stripe deposit rail re-enable (needs Connect onboarding + webhook config).
- Liability-account mapping for the deposit item (v1 uses the default
  income item; the interim revenue on an outstanding deposit invoice is the
  same interim state Kato's manual halving produces, and it nets out at
  settlement).
- Deposits on broker quotes (broker quotes never get QB checkout — same
  exclusion as full payment today).
