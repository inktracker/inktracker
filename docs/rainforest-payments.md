# InkTracker payments (Rainforest)

Customers of an opted-in shop pay on InkTracker's own page instead of a
QuickBooks invoice link. InkTracker sets the price (matched to QuickBooks:
**2.99% card, 1% bank, no fixed fee, no cap**) and earns the difference
between that and Rainforest's buy rate.

Status: **dormant**. Nothing changes for any shop until all three hold:

1. `RAINFOREST_ENABLED=true` (Supabase secret, platform kill switch)
2. the shop's merchant account is approved (`processor_accounts.merchant_status = 'active'`)
3. the shop owner turned it on (`processor_accounts.enabled = true`)

Anything unknown or unreadable resolves to the QuickBooks rail
(`_shared/paymentRail.js`). A wrong "qb" means the customer pays through
QuickBooks like today. A wrong "processor" would mean an invoice nobody can
pay, so it is never the fallback.

## How money and books flow

```
customer pays on InkTracker ─► Rainforest ─► webhook ─► processor_payments (ledger)
                                                     └► QB Payment (gross, linked to the invoice,
                                                        into Undeposited Funds)
                                                            │
                     QuickBooks' own webhook ◄──────────────┘
                     └► existing paid pipeline (qbWebhook): convert quote → order,
                        cascade paid, notify. Unchanged, no second "mark paid" path.

Rainforest payout ─► QB Deposit to the shop's bank = linked payments − fee line
                     (must equal what hit the bank to the cent, or it isn't posted)
```

Rules that keep it safe:

* **Amount = the LIVE QuickBooks balance**, never InkTracker's saved total.
  Deposits, QB-side discounts and applied credits come out right, and a
  second click after paying charges nothing (`choosePayTarget`).
* **Webhook metadata is a hint, not proof.** Ownership is re-derived:
  merchant id → our `processor_accounts` row → shop. The paid document
  must belong to that shop and still point at the invoice in the metadata
  (`planPayinEffect`).
* **Money is always recorded.** Unmatched money is written to the ledger
  against the shop whose merchant received it, not posted to QuickBooks,
  and the shop is alerted.
* **Statuses only move forward**, so a replayed or late webhook can't undo
  a success.
* **Overpayment** (two payments race): apply up to the balance and leave
  the rest as a QuickBooks customer credit, flagged "refund it".
* **Reversals** (refund, bank return, lost chargeback) never auto-un-pay an
  invoice. The shop is told, and the money shows up as a signed line on
  the next payout's Deposit so the bank still matches.
* **Broker invoices always stay on QuickBooks.**

### When is an invoice "paid"?

* **Card:** at `payin.processing`, when the card is captured. That's the same moment QuickBooks Payments marks a card invoice paid, so quote → order isn't held a day (Rainforest deposits card T+1). If a captured card is later voided (`payin.canceled`), the shop is alerted with the QB payment to delete. We never delete it ourselves.
* **Bank (ACH):** only at `payin.succeeded`, after the default T+4 hold. `processing` is recorded but not booked. Returns can still arrive later (up to 90 days for unauthorized), and are handled as reversals.

### Platform fee setup (Rainforest billing profile)

The fee is the merchant's **all-in** price. Rainforest keeps its cost and pays InkTracker the spread monthly as residuals. Rates are integers where 3000 = 3%:
`card_rate: 2990`, `card_fee: 0`, `card_amex_rate_surcharge: 0`, `card_business_rate_surcharge: 0`, `card_international_rate_surcharge: 0`, `ach_rate: 1000`, `ach_rate_cap: 0` (confirm 0 = no cap), `ach_fee: 0`. Leaving the surcharges at 0 keeps it a flat 2.99% like QuickBooks, which charges no Amex premium.
Create it first: a billing profile must exist before the first merchant.

### When a shop's InkTracker plan lapses

Nightly sweep (`checkPlanLapses`): a switched-on shop that stops paying is warned once with a date. Customers keep paying on InkTracker for 14 days (`PLAN_GRACE_DAYS`), then NEW quotes/invoices go back to QuickBooks pay links (a second notice tells them to re-send open ones). Payouts, refunds and disputes never stop. Account → Payments stays reachable in read-only mode. Renewing switches it straight back on. A lapsed shop can't switch payments on. Terms to be written into the Payment Processing Agreement; ask Rainforest whether they require tool access to continue after a merchant leaves.

### Rainforest rules that affect rollout

* InkTracker's own company has to be the first production merchant, and that sets the residuals bank account.
* Production review checks every session is constrained to one merchant (never `group#all`).
* Rainforest discourages letting trial or free accounts sign up for payments, and says they're usually declined. Gate Account → Payments to paying shops.
* Merchants that never finish onboarding are auto-canceled after 120 days.

## What changes for an opted-in shop

| Surface | QuickBooks rail (today) | Processor rail |
|---|---|---|
| qbSync createInvoice / deposit | mints QB pay link; AllowOnline* omitted | no mint, no `/send` fallback email; old link cleared; `AllowOnlineCreditCardPayment/ACHPayment=false` on create **and** sparse update |
| SendQuoteModal | needs a QB link to be "ready" | invoice existing = ready; email → QuotePayment |
| SendInvoiceModal | email/PDF button → QB link | email/PDF button → `/invoicepayment?id&token` (token minted once) |
| QuotePayment / InvoicePayment | redirect to QB | Rainforest payment component *(pending API)* |

The AllowOnline* exception is deliberate: Joe's 18 Sept rule ("QB should be
doing that") stands for every QuickBooks-rail shop. A source-contract test
(`paymentRail.test.js`) pins that the flags are only ever set through
`applyRailToInvoiceBody`, and that the rail is read from the authenticated
shop, never the request body.

## Pieces

| File | What |
|---|---|
| `_shared/rainforestPricing.js` | platform fee in integer cents |
| `_shared/rainforestPayinPlan.js` | what to charge, idempotency key, metadata, Level 2/3 detail |
| `_shared/rainforestPayinEffect.js` | what a payment event does |
| `_shared/rainforestQbBooks.js` | QB Payment / Deposit bodies, reversal plan |
| `_shared/paymentRail.js` | qb vs processor |
| `_shared/rainforestAccount.js` | roles, onboarding stage, QB account mapping |
| `_shared/qbShopClient.ts` | QB reads/writes for a shop (serialized token refresh) |
| `rainforest/` | edge fn: status, qbAccounts, saveQbAccounts, setEnabled |
| migration `20261120000000` | `processor_accounts`, `processor_payments`, `processor_payouts`, `invoices.public_token` |

Tables are `processor_*` because `payment_accounts` already exists (the
Expenses feature's accounts a shop pays bills from).

Roles: status is visible to the shop's team (not brokers). Owner or manager
maps QB accounts. **Only the owner** switches it on or off, because it's
billing.

## Status

Built (dormant):

- [x] Merchant sign-up: `startOnboarding` creates the merchant once, prefilled from the shop profile (never SSN/tax id), plus a 1-hour session scoped to that merchant. The Account → Payments card embeds Rainforest's form. Owner only, paid plans only.
- [x] QuickBooks account mapping + owner-only on/off switch (Account → Payments)
- [x] Customer payment: `payRail` / `payinSession` (public, token-gated). The quote page's "Approve & Pay" opens the embedded form for switched shops. New `/invoicepayment` page for invoice emails and PDFs.
- [x] Level 2/3 data in Rainforest's `level_2_3` shape, with exact arithmetic
- [x] `rainforestWebhook`: signature check, event mapping, ledger, QB Payment exactly once
- [x] Payouts → QB Deposit (clean payouts only; anything else is sent to the shop with a breakdown)
- [x] Nightly sweep for anything not recorded (gated by the `RAINFOREST_SWEEP` repo variable)
- [x] CSP (report-only) allows `static.rainforestpay.com`, `*.rainforestpay.com`, Plaid

Needs Joe / Rainforest before going live:

- [ ] **Payment Processing Agreement page.** Rainforest's sign-up form requires a terms link titled "Payment Processing Agreement" with their required language and a fee table. It's a legal document for Joe to approve (and ideally a lawyer). Then set `RAINFOREST_TERMS_URL`. It's a placeholder until then.
- [ ] Billing profile (2.99% / 1%, no surcharges) created in the Rainforest portal; it must exist before the first merchant
- [ ] Webhook endpoint in the portal → `…/functions/v1/rainforestWebhook`; secret → `RAINFOREST_WEBHOOK_SECRET`
- [ ] Secrets: `RAINFOREST_API_KEY`, `RAINFOREST_API_BASE`, and finally `RAINFOREST_ENABLED=true`
- [ ] Confirm with Rainforest: Svix headers, `address` vs `billing_contact`, commodity code `8212`, whether `ach_rate_cap: 0` means no cap
- [ ] Apple Pay / Google Pay: not enabled (`allowed-methods="CARD,ACH"`). If added, `Permissions-Policy: payment` needs Rainforest's origin.

## Deploy order (when it's time)

1. Migration (additive; nothing reads it until the flag is on)
2. Edge functions: `qbSync`, `rainforest`, `rainforestWebhook`
3. Frontend
4. Set `RAINFOREST_ENABLED=true` only after the sandbox plan below passes. Biota first.

## Sandbox test plan

Each item needs a pass in the Rainforest sandbox **and** the QuickBooks sandbox company before Biota goes live.

**QuickBooks API behaviour (verify, don't assume)**
- [ ] A Deposit with linked Payments **plus a negative `DepositLineDetail` fee line** is accepted, and its total = payments − fee
- [ ] A Payment with `Line: []` (fully unapplied) is accepted as a customer credit
- [ ] Dedupe before posting reads the customer's recent Payments (`WHERE CustomerRef = …`, the same query qbSync already uses) and matches `PaymentRefNum` / the payin id in the memo. Confirm both are stored on sandbox payments.
- [ ] Sparse update with `AllowOnlineCreditCardPayment:false` / `AllowOnlineACHPayment:false` removes the Pay button from the QB-sent invoice and portal
- [ ] With both flags false, `include=invoiceLink` returns no link (otherwise the refresh writers would repopulate `qb_payment_link`, which is harmless because the processor-rail screens ignore it, but confirm)
- [ ] Posting a Payment fires QuickBooks' own webhook → `qbWebhook` runs the paid pipeline (convert, cascade, notify) exactly as a QB Payments payment does

**Happy paths**
- [ ] Card, full invoice: charge = live Balance; ledger `succeeded`; QB Payment gross into Undeposited Funds, method "Credit Card"; quote → order; shop notified once
- [ ] Bank (ACH): `processing` recorded, nothing posted to QB; on `succeeded`, QB Payment posted
- [ ] Deposit quote: pays the deposit invoice; final invoice later shows the deposit applied; remainder paid on InkTracker
- [ ] Invoice (order-then-invoice): `/invoicepayment` link from SendInvoiceModal + PDF; payment posts against the invoice
- [ ] Payout: QB Deposit equals the sandbox payout amount to the cent; bank feed matches

**Shop tools**
- [ ] Account → Payments → Payments & payouts: owner can refund (full + partial) and respond to a dispute; a manager sees the reports but no Refund/Respond; the report only ever shows that shop's merchant
- [ ] Account deletion is refused while the merchant is open, with the "turn off and contact support" message

**Devices**
- [ ] Customer pays inside the iOS app's web view (card, and the Plaid bank-login popup); onboarding form there too

**Backstops**
- [ ] Nightly sweep's Rainforest backstop: `GET /v1/payins?created_at.start=…` response shape (`results` + `last_key`?) — kill the webhook mid-payment in sandbox and confirm the sweep records and books it
- [ ] Onboarding adopt: `GET /v1/merchants?name=…` returns our `metadata` and the application id (or `/applications` does)

**Failure paths**
- [ ] Replay the same success webhook ×3 → one ledger row, one QB Payment
- [ ] QB down during webhook → ledger `succeeded`, `qb_payment_id` null → replay/retry posts it once
- [ ] Quote re-invoiced (new QB id) between page load and payment → recorded, NOT posted, shop alerted
- [ ] Two tabs pay the same invoice → second payment becomes a QB credit flagged "refund it"
- [ ] ACH return after success → ledger `returned`, shop alert, invoice not auto-un-paid, next payout Deposit carries the negative adjustment
- [ ] Refund (full + partial) → info notice with the refunded amount
- [ ] Dispute → alert; lost → `charged_back`
- [ ] Forged webhook (bad signature) → 401, nothing written
- [ ] Merchant id no shop owns → nothing written, ops alert
- [ ] Kill switch off mid-flight → status reports QB, qbSync mints QB links again, open pay pages refuse new sessions
- [ ] Tax-held invoice → SendInvoiceModal refuses to send

**Money checks**
- [ ] Platform fee on the sandbox statement = `platformFeeCents` for every test payment (2.99% card, 1% bank, half-up to the cent)
- [ ] Level 2/3 data present on a full-invoice business-card payment; absent on deposit/balance payments

## Structured audit (2026-09-30)

Four passes (sign-up/settings, customer pays, payouts/reversals/sweep, security), each walking every step through seven questions: dies here · stale state · duplicate/out-of-order/missing events · time/timezone · multi-day delays · unverified external assumptions · fix-induced failures. 29 findings, all fixed. Highlights:

- Merchant webhooks are triggers only: the current status is read from Rainforest (a late retry can't undo a suspension)
- Nightly backstops for everything the webhook can lose: payins (10-day window), bank payments stuck "processing", chargebacks/returns, payouts, merchant status
- A QuickBooks Deposit post is released for retry only on a definite 4xx; anything ambiguous is flagged, never re-posted
- Payments are booked whenever money came in, even if a refund/dispute event arrived first
- Waiting payouts escalate to the shop after 5 days; unmatched payments go straight to review
- Deposit invoices aren't voided while a bank-paid deposit is clearing
- Pay-link throttle (90s session reuse); race-safe invoice token
- Sign-up: merchants matched by name + email (Rainforest merchants have no metadata); closed applications can be restarted; application status read from `latest_merchant_application`
- Owner alerts: needs-information, approved, payout returned, dispute won
- Follow-up pass: shops had no way to refund or answer disputes (Rainforest's portal is platform-only) → embedded payment/payout reports in Account → Payments; account deletion now refuses while the merchant is open and purges the payment tables
