# Stripe quote-payment webhook (`stripeWebhook`) — **intentionally dormant in v1**

> **Read this first.** In v1, **customer quote payments are handled through
> QuickBooks** (QB invoice + QB's payment link), and **QuickBooks sends the
> customer's payment receipt.** The InkTracker Stripe-checkout path
> (`createCheckoutSession` → `stripeWebhook`) is **NOT the active payment channel**
> — it is deliberately dormant. A `stripeWebhook` with zero `payment_confirmation`
> events is **expected and correct**, not a gap. The shop owner still learns of
> every payment via the QuickBooks path (the `quote_payment` notification, emitted
> by `qbWebhook` / `qbReconcile` / `qbSync`). See `project_qb_critical_path`:
> "QB is the sole customer-payment integration in v1."
>
> **Do not re-derive a "customers get no confirmation email" gap from the empty
> Stripe log** — they get it from QuickBooks. This doc exists so nobody trips on
> that again.

This runbook is retained for the **v2** scenario only — if/when a real Stripe
quote-checkout collection path is activated (e.g. shops without QuickBooks). The
webhook code is already production-grade — async signature verify, at-least-once
idempotency, Connect account-mismatch rejection, deposit/final logic, QB payment
mirroring, both emails retried + logged — so the v2 flip is pure config.

## Current state (verified 2026-07-23)
- Function: `stripeWebhook`, **deployed** (ACTIVE, `verify_jwt = false`).
- URL: `https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/stripeWebhook`
- `STRIPE_WEBHOOK_SECRET`: **set** — the webhook is **armed but idle**. It
  **fails closed** (rejects unsigned/invalid events) and is **idempotent**, so
  arming it is harmless: on the v1 QB payment flow it simply never fires. It only
  does anything if a Stripe Connect checkout is ever actually completed (v2).
  (`STRIPE_BILLING_WEBHOOK_SECRET` is the separate, active *subscription* webhook.)
- Charge model (for v2): **Stripe Connect direct charges** — checkout sessions are
  created with `stripeAccount: <shop>` (createCheckoutSession:523), so completion
  events fire **on the connected accounts**.

---

## v2 activation steps (only when the Stripe checkout path goes live)

## ⚠️ The one gotcha
Because charges are on connected accounts, the endpoint **must listen to events on
Connected accounts**. A normal "Your account" endpoint will never receive these
events and the webhook will stay dormant even with the secret set.

## Steps (Stripe Dashboard, LIVE mode — your customer payments use a live key)

1. **Developers → Webhooks → Add endpoint.**
   - **Endpoint URL:** `https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/stripeWebhook`
   - **Listen to events on:** **Connected accounts** ← critical (not "Your account").
   - **Events to send:**
     - `checkout.session.completed`  ← the one that sends the emails + marks paid
     - `checkout.session.expired`
     - `account.updated`  ← keeps each shop's Connect status in sync
2. **Copy the endpoint's Signing secret** (`whsec_…`).
3. **Set it in Supabase** (no redeploy needed — the function reads it at request time):
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
   ```
4. **Test with a real payment** (best signal): pay a small quote as a customer.
   Confirm: (a) the customer gets a "Payment Confirmed" email, (b) the shop owner
   gets one, (c) the quote flips to Approved and Paid, (d) Stripe shows the event
   delivered `200`.

## Verify it fired
```sql
select event_type, recipient_role, status, count(*), max(created_at)
from notification_log
where event_type = 'payment_confirmation'
group by 1,2,3 order by 1,2,3;
```
Before go-live this returns **0 rows**. After a successful test payment you should
see `payment_confirmation` for **both** `shop_owner` and `customer`, `status=sent`.

## Rollback / safety
- The function **fails closed** without the secret, and **verifies every event's
  signature** — a misconfigured or malicious call is rejected, never processed.
- **Idempotent** — Stripe's at-least-once re-deliveries are deduped, so no
  double-emails or double payment records.
- To pause: delete the Stripe endpoint (or unset the secret) — it returns to
  dormant, harming nothing.
