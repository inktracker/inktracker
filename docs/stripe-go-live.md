# InkTracker payments: go-live checklist

Switching InkTracker payments (Stripe Connect) from the sandbox to live
money. The design and the reasons behind it are in
[stripe-payments.md](stripe-payments.md); this is only the order of steps.

**Who does what:** Joe works in the Stripe dashboard and sets every key from
his own terminal. Claude checks each step from the InkTracker side. No key,
signing secret or password ever goes through chat.

## Before the switch

- [ ] **Sandbox tests passed** (TEST quotes only):
  - [x] Credit card: surcharge charged and shown (Q-2026-37KF, 2026-10-02)
  - [x] Debit card: no surcharge (Q-2026-400F, 2026-10-02)
  - [ ] Bank transfer, with the fee as its own line on Stripe's page
  - [ ] QuickBooks chain: one test payment booked on purpose
    (`STRIPE_TEST_BOOKS_TO_QB=true` for one payment, then unset). The quote
    should become a paid order and you should get the paid notice. Delete
    that QuickBooks payment afterwards.
- [ ] **Card surcharge notice**, only if Biota will surcharge credit cards.
  From Biota's own Stripe account, tell Stripe support you'll surcharge
  credit cards at 2.99%, starting 30+ days later (Visa rule). Bank fees
  and plain card payments don't need this and can go live first.
- [ ] **Terms of service**: section 5A (InkTracker Payments) reviewed and
  published. Stripe requires platforms to disclose their fees to shops.

## Stripe dashboard: InkTracker's account in LIVE mode

Everything set up in the sandbox has to be set up again in live mode.

- [ ] **Activate the platform account**, if Stripe asks: business details
  for Biota LLC and the bank account for InkTracker's own earnings.
- [ ] **Connect**: Settings → Connect, platform profile "Platform or
  marketplace", Standard accounts allowed.
- [ ] **Branding** (Settings → Connect → Branding), so sign-up says InkTracker.
- [ ] **Onboarding options → Tax**: turn OFF "Show tax during signup".
  QuickBooks is the only tax authority.
- [ ] **Onboarding options → OAuth**:
  - Add the redirect URI `https://www.inktracker.app/Account?payments=oauth`.
  - Copy the live client id (`ca_…`).
- [ ] **Webhook**: Developers → Webhooks → add an endpoint that listens to
  **events on Connected accounts**:
  - URL: `https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/stripeConnectWebhook`
  - Events:
    - `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`
    - `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
    - `payout.paid`, `payout.failed`
    - `account.updated`, `account.application.deauthorized`
  - Copy its signing secret (`whsec_…`).

## Keys (Joe, own terminal; all four at once)

```
npx supabase secrets set --project-ref skmltfbibaqcjddmeqvi \
  STRIPE_CONNECT_SECRET_KEY=sk_live_… \
  STRIPE_CONNECT_WEBHOOK_SECRET=whsec_… \
  STRIPE_CONNECT_CLIENT_ID=ca_… \
  STRIPE_CONNECT_PUBLISHABLE_KEY=pk_live_…
```

- [ ] Make sure `STRIPE_TEST_BOOKS_TO_QB` is **not** set.
- [ ] Claude checks:
  - the status card no longer says "Stripe test mode";
  - the 6am health check's "Stripe payments" line reads "live";
  - a webhook test delivery from the Stripe dashboard returns 200.

From this moment the sandbox setup is inactive. Test payments stay recorded
as test and are never booked.

## Biota goes live

The sandbox account doesn't exist under the live key, so Biota sets up again.

- [ ] Account → Payments: **I already have a Stripe account**, then connect
  Biota's real Stripe account.
- [ ] In Biota's Stripe account, check that **ACH Direct Debit** (bank
  transfer) is turned on under payment methods.
- [ ] Check the QuickBooks accounts: the payout bank account and the fees
  expense account.
- [ ] Choose what to accept (Cards / Bank transfer). Turn on **Pass fees to
  customers** only after the 30-day notice; the bank fee alone can start
  earlier.
- [ ] **Turn on InkTracker payments.** Every Biota quote and invoice now
  goes to the Stripe pay page, not just TEST ones.

## First real payment

- [ ] Send a small real invoice ($1–5) to yourself and pay it by card. Check:
  - Stripe receipt;
  - QuickBooks payment on the invoice;
  - quote converts to a paid order;
  - paid notice in InkTracker.
- [ ] Wait for the payout (2 business days or so). Check:
  - the QuickBooks deposit equals the bank deposit to the cent;
  - fees and any customer-paid fee appear on their own lines.
- [ ] Refund it from Stripe. The refund notice should arrive in InkTracker.
- [ ] Then real customers. Watch the 6am health check for the first weeks.

## Afterwards

- Bank-earnings rebate on the subscription (100% back, up to the plan
  price): build after a month of live payments. See the calculator at
  https://claude.ai/artifact/W1JfBLrogjbL5EEgeG6y8E.
