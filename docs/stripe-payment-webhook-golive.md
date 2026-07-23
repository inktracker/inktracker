# Go-live: customer payment-confirmation webhook (`stripeWebhook`)

The customer-payment webhook is **built, deployed, and dormant** — it fails closed
because `STRIPE_WEBHOOK_SECRET` isn't set and no Stripe destination points at it.
Until it's wired, **customers who pay receive no confirmation email** (the shop
owner still learns of payment via the QuickBooks path). This is pure config — no
code change.

_Prepared 2026-07-23. Audited: code is production-grade — async signature verify,
at-least-once idempotency, Connect account-mismatch rejection, deposit/final logic,
QB payment mirroring, both emails retried + logged._

## Current state (verified)
- Function: `stripeWebhook`, **deployed** (ACTIVE, `verify_jwt = false`).
- URL: `https://skmltfbibaqcjddmeqvi.supabase.co/functions/v1/stripeWebhook`
- Missing: `STRIPE_WEBHOOK_SECRET` (the *billing* one — `STRIPE_BILLING_WEBHOOK_SECRET`
  — is set; this is a different webhook).
- Charge model: **Stripe Connect direct charges** — checkout sessions are created
  with `stripeAccount: <shop>` (createCheckoutSession:523), so completion events
  fire **on the connected accounts**.

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
