# InkTracker payments (Stripe Connect)

Customers of an opted-in shop pay quotes and invoices by card or bank on
**Stripe Checkout** instead of a QuickBooks invoice link. The shop's all-in
cost stays what QuickBooks charges today (**2.99% card, 1% bank**);
InkTracker earns the gap between that and Stripe's own fee.

First built for Rainforest (2026-09-30). Switched to Stripe on 2026-10-01
after Rainforest quoted a **$20,000 onboarding fee**, which at InkTracker's
size would take well over a decade to earn back. Stripe has no setup or
monthly fee for this model.

Status: **dormant**. Nothing changes for any shop until all three hold:

1. `STRIPE_PAYMENTS_ENABLED=true` (Supabase secret, platform kill switch)
2. the shop's Stripe account is active (`processor_accounts.merchant_status = 'active'`)
3. the shop owner turned it on (`processor_accounts.enabled = true`)

Anything unknown or unreadable resolves to the QuickBooks rail
(`_shared/paymentRail.js`). A wrong "qb" means the customer pays through
QuickBooks like today. A wrong "processor" would mean an invoice nobody can
pay, so it is never the fallback.

### Test mode is safe for real customers and real books

While `STRIPE_CONNECT_SECRET_KEY` is a **test** key:

* only quotes/invoices with **TEST** or **DEMO** in the customer, company or
  job name use Stripe (`paymentRail.isTestDocument`, applied in qbSync, the
  pay pages and both send screens). Every real quote and invoice keeps its
  QuickBooks pay link, so no real customer is sent a test checkout;
* test payments and payouts are recorded in InkTracker but **never posted
  to the shop's QuickBooks** (`qb_post_error` says so), unless
  `STRIPE_TEST_BOOKS_TO_QB=true` is set on purpose (a shop connected to a
  QuickBooks sandbox company).

**Going live:** every account remembers its Stripe mode
(`processor_accounts.stripe_livemode`). Under the live key a test-mode
account reads as "not set up" (rail = QuickBooks, no false "disconnected"
alert); the owner runs the sign-up once more and a live account replaces it.

## The Stripe model

**Connect Standard accounts + direct charges + application fee.**

* Each shop gets **its own Stripe account** (created by InkTracker, finished
  on Stripe's hosted sign-up), or connects one it already has ("I already
  have a Stripe account", Connect OAuth with a one-time state). The shop is merchant of record: its own
  Stripe dashboard, its own payouts, its own disputes and refunds.
  InkTracker carries no loss risk.
* Checkout Sessions are created **on the shop's account** (`Stripe-Account`
  header) with `payment_intent_data.application_fee_amount` = InkTracker's
  cut. Stripe takes its own fee from the shop and moves the application fee
  to InkTracker's Stripe balance automatically. No residuals to reconcile.
* Because a Standard account is the shop's whole Stripe account, it can
  carry sales that have nothing to do with InkTracker (an online store, a
  terminal). **Only PaymentIntents with InkTracker's metadata are ours**;
  the webhook, backstops and payout booking ignore or flag everything else.

### Pricing (`_shared/paymentsPricing.js`)

| | QuickBooks (shop pays today) | Stripe's own fee | InkTracker's fee |
|---|---|---|---|
| Card | 2.99% | 2.9% + 30¢ | the difference, never negative |
| Bank (ACH) | 1% | 0.8% capped $5, + $1.50 instant verification | the difference, never negative |

Examples (Biota's real averages): $1,126.48 card → InkTracker 71¢;
$1,297 bank → InkTracker $6.47. On a card payment under about $333 Stripe's
30¢ makes its fee higher than 2.99%; InkTracker then takes nothing and the
shop pays Stripe's price (a few cents over QuickBooks). International cards
(+1.5%) and currency conversion (+1%) are Stripe's standard extras, paid by
the shop like any Stripe merchant.

## How money and books flow

```
customer picks card/bank ─► Stripe Checkout (shop's account) ─► Connect webhook
                                                             ─► processor_payments (ledger)
                                                             └► QB Payment (gross, linked to the invoice,
                                                                into Undeposited Funds)
                                                                    │
                     QuickBooks' own webhook ◄──────────────────────┘
                     └► existing paid pipeline (qbWebhook): convert quote → order,
                        cascade paid, notify. Unchanged, no second "mark paid" path.

Stripe payout ─► payout.paid ─► balance transactions ─► QB Deposit to the shop's bank
                 = linked payments − fees (Stripe's + InkTracker's)
                 (must equal what hit the bank to the cent, or it isn't posted)
```

Rules that keep it safe:

* **Amount = the LIVE QuickBooks balance**, never InkTracker's saved total
  (`choosePayTarget`). Deposits, QB-side discounts and credits come out
  right, and paying twice is blocked while one is in flight.
* **Webhook metadata is a hint, not proof.** Ownership is re-derived:
  `event.account` → our `processor_accounts` row → shop. The paid document
  must belong to that shop and still point at the invoice in the metadata
  (`planPayinEffect`).
* **Money is always recorded.** InkTracker money that no longer matches an
  invoice is written to the ledger (not posted to QuickBooks) and the shop
  is alerted.
* **Statuses only move forward**, so a replayed or late event can't undo a
  success.
* A **declined card** is retried on the same PaymentIntent, so
  `payment_intent.payment_failed` is ignored for cards; a failure/cancel we
  never saw start writes nothing (the retry can still succeed).
* **Overpayment** (two payments race): apply up to the balance, the rest is
  a QuickBooks customer credit, shop told to refund it from Stripe.
* **Reversals** (refund, bank return, lost dispute) never auto-un-pay an
  invoice. The shop is told, and the payout that carries it is left for
  the shop to record.
* **Broker invoices always stay on QuickBooks.**

### When is an invoice "paid"?

* **Card:** `payment_intent.succeeded` (captured), same moment QuickBooks
  Payments marks a card invoice paid.
* **Bank (ACH):** `processing` is recorded and the shop is told it started;
  booked only at `succeeded` (~4 business days). A dispute on a bank payment
  is a return (no evidence process).

### Events the Connect endpoint needs

`payment_intent.processing`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `payment_intent.canceled`,
`charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
`payout.paid`, `payout.failed`, `account.updated`,
`account.application.deauthorized`.

### When a shop's InkTracker plan lapses

Nightly sweep (`checkPlanLapses`): a switched-on shop that stops paying is
warned once with a date. Customers keep paying through Stripe for 14 days
(`PLAN_GRACE_DAYS`), then NEW quotes/invoices go back to QuickBooks pay
links. The shop's Stripe account, payouts, refunds and disputes are its own
and never stop. Renewing switches it straight back on.

### Disconnects

A shop can disconnect InkTracker from its Stripe account. On
`account.application.deauthorized` (or when the nightly sync can no longer
read the account) payments switch off at once, back to QuickBooks, owner
told. Deleting a shop's InkTracker account requires switching payments off
first; the Stripe account stays the shop's.

## What changes for an opted-in shop

| Surface | QuickBooks rail (today) | Processor rail |
|---|---|---|
| qbSync createInvoice / deposit | mints QB pay link; AllowOnline* omitted | no mint; old link cleared; `AllowOnlineCreditCardPayment/ACHPayment=false` on create **and** sparse update |
| SendQuoteModal | needs a QB link to be "ready" | invoice existing = ready; email → QuotePayment |
| SendInvoiceModal | email/PDF button → QB link | email/PDF button → `/invoicepayment?id&token` |
| QuotePayment / InvoicePayment | redirect to QB | "Pay by card" / "Pay by bank transfer" → Stripe Checkout → back with `?paid=card\|ach` |
| Account → Payments | — | Stripe-hosted sign-up, QB account mapping, on/off, link to the shop's Stripe dashboard (refunds, disputes, payouts) |

## Pieces

| File | What |
|---|---|
| `_shared/paymentsPricing.js` | QuickBooks price, Stripe's fee, InkTracker's application fee (integer cents) |
| `_shared/payinPlan.js` | what to charge (live QB balance), checkout idempotency key + expiry, metadata |
| `_shared/stripeRequests.js` | account create, account link, Checkout Session bodies |
| `_shared/stripeWebhookAdapter.js` | signature check, Stripe events → neutral events, account status, payout items |
| `_shared/payinEffect.js` | what a payment event does |
| `_shared/payoutPlan.js` | payout → QB Deposit (clean payouts only) |
| `_shared/paymentsQbBooks.js` | QB Payment / Deposit bodies, reversal notices |
| `_shared/paymentRail.js` | qb vs processor |
| `_shared/paymentsAccount.js` | roles, onboarding stage, QB account mapping |
| `_shared/stripeApi.ts` + `stripeForm.js` | thin Stripe client (form encoding, `Stripe-Account`, `Idempotency-Key`) |
| `stripePayments/` | edge fn: status, startOnboarding, refreshStatus, qbAccounts, saveQbAccounts, setEnabled, payRail, payinSession |
| `stripeConnectWebhook/` | edge fn: Connect webhook + nightly sweep |
| migration `20261122000000_processor_payments` | `processor_accounts`, `processor_payments`, `processor_payouts`, `processor_pay_sessions`, `invoices.public_token` |

Roles: status is visible to the shop's team (not brokers). Owner or manager
maps QB accounts. **Only the owner** signs up and switches it on or off.

## Joe's setup (Stripe dashboard) before testing

1. **Turn on Connect** on InkTracker's Stripe account (Settings → Connect),
   platform profile: "Platform or marketplace", Standard accounts allowed.
2. **Test mode first.** Copy the *test* secret key (`sk_test_…`) and set it:
   `npx supabase secrets set STRIPE_CONNECT_SECRET_KEY=… --project-ref skmltfbibaqcjddmeqvi`
   (Joe runs this himself; keys never go through chat). Separate from the
   live billing key on purpose.
3. **Connect webhook endpoint** (test mode, "Events on Connected accounts"):
   `https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/stripeConnectWebhook`
   with the events listed above. Its signing secret →
   `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. Branding (Settings → Connect → Branding) so the sign-up page says InkTracker.
4a. For "I already have a Stripe account": Settings → Connect → Onboarding
   options → OAuth: copy the **client id** (`ca_…`) into
   `STRIPE_CONNECT_CLIENT_ID` and add the redirect URI
   `https://www.inktracker.app/Account?payments=oauth`. Without the client id
   the option simply doesn't show.
5. InkTracker's terms should say shops pay QuickBooks-matched rates and that
   InkTracker keeps the difference over Stripe's fee (Stripe requires
   platforms to disclose their fees). Stripe's own Connected Account
   Agreement is accepted by the shop during Stripe's sign-up.
6. Then `STRIPE_PAYMENTS_ENABLED=true`, and Biota signs up in test mode.

## Deploy order (when it's time)

1. Migration (additive; nothing reads it until the flag is on)
2. Edge functions: `qbSync`, `adminAction`, `stripePayments`, `stripeConnectWebhook`
3. Frontend
4. `gh variable set STRIPE_PAYMENTS_SWEEP --body true` (nightly sweep)
5. `STRIPE_PAYMENTS_ENABLED=true` only after the test plan below passes. Biota first.

## Test-mode plan

Stripe test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002`
(declined), `4000 0000 0000 0259` (succeeds, then disputed). Test bank:
"Test Institution" in the bank login, which succeeds after a few minutes.

**QuickBooks behaviour (verify, don't assume)**
- [ ] A Deposit with linked Payments **plus a negative fee line** is accepted, and its total = payments − fee
- [ ] A Payment with `Line: []` (fully unapplied) is accepted as a customer credit
- [ ] Dedupe finds a posted Payment by `PaymentRefNum` (last 21 chars of the `pi_…` id) / the id in the memo
- [ ] `AllowOnlineCreditCardPayment:false` / `AllowOnlineACHPayment:false` removes the QB Pay button
- [ ] Posting a Payment fires QuickBooks' own webhook → `qbWebhook` runs the paid pipeline

**Stripe behaviour (verify, don't assume)**
- [ ] `POST /v1/accounts` type=standard works on InkTracker's platform; Account Link sign-up returns to Account → Payments and `refreshStatus` shows the right stage
- [ ] `application_fee_amount` lands in InkTracker's balance and the shop's balance transaction `fee` = Stripe fee + application fee
- [ ] The $1.50 bank verification fee is charged to the **shop's** account (else adjust `STRIPE_COST.ach.verifyCents`)
- [ ] Checkout with `us_bank_account` works on a fresh Standard account (or ACH must be enabled first → the "pay by card" message)
- [ ] `GET /v1/balance_transactions?payout=…&expand[]=data.source.payment_intent` returns the PaymentIntent metadata
- [ ] `account.application.deauthorized` arrives on the Connect endpoint
- [ ] `GET /v1/payment_intents/search` with `Stripe-Account` finds InkTracker payments by metadata (the nightly backstop)
- [ ] Checkout's `receipt_email` gets the customer a Stripe receipt
- [ ] "I already have a Stripe account": the OAuth round trip links it; a second shop can't link the same account
- [ ] A real (non-TEST) quote sent while in test mode still carries its QuickBooks pay link

**Happy paths**
- [ ] Card, full invoice: charge = live Balance; ledger `succeeded`; QB Payment gross into Undeposited Funds, method "Credit Card"; quote → order; shop notified once
- [ ] Bank: `processing` recorded (shop told it started), nothing in QB; on `succeeded`, QB Payment posted
- [ ] Deposit quote: pays the deposit invoice; remainder paid later
- [ ] Invoice (order-then-invoice): `/invoicepayment` link; payment posts against the invoice
- [ ] Payout: QB Deposit equals the payout to the cent; bank feed matches

**Failure paths**
- [ ] Replay the same event ×3 → one ledger row, one QB Payment
- [ ] QB down during webhook → 500, Stripe retries, posts once
- [ ] Declined card then success on the same Checkout → booked once
- [ ] Two tabs pay the same invoice → second becomes a QB credit flagged "refund it"
- [ ] Refund (full + partial) → info notice with the refunded amount
- [ ] Dispute (`4000…0259`) → alert + email; lost → `charged_back`
- [ ] A sale made directly in the shop's Stripe dashboard → ignored; its payout → "needs recording" with "a sale taken in Stripe outside InkTracker"
- [ ] Forged webhook (bad signature) → 401, nothing written
- [ ] Kill switch off mid-flight → status reports QB, qbSync mints QB links again
- [ ] Tax-held invoice → no checkout

## History: the Rainforest audit

The Rainforest build had a four-pass structured audit (29 findings, all
fixed); its processor-neutral parts (live-balance charging, forward-only
ledger, exactly-once QuickBooks posting, payout claims that are never
retried blind, plan-lapse grace, nightly backstops) carried over unchanged.
