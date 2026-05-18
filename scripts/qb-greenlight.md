# QB Integration — Green-Light Test Plan

End-to-end verification of the QuickBooks integration. Pair with `qb-greenlight.sh` (automated checks) for full coverage.

---

## 0. Pre-flight

Before you start, get a fresh JWT for the automated checks:

1. Open InkTracker in your browser, signed in as the shop owner
2. DevTools → Application → Local Storage → key `sb-skmltfbibaqcjddmeqvi-auth-token`
3. Copy the `.access_token` field value
4. `export JWT='eyJ...'` in the terminal you'll run the script from
5. `./scripts/qb-greenlight.sh` — expect 9 passed / 0 failed / 0 skipped

The JWT expires hourly. If a check fails with 401, refresh it.

---

## 1. Automated — the bash script

`./scripts/qb-greenlight.sh` covers:

| # | Check | What it proves |
|---|---|---|
| 1 | All 5 QB-related edge fns answer OPTIONS preflight | Functions are deployed and reachable |
| 2 | `qbSync checkConnection` returns `{ connected: true }` | OAuth tokens are valid and persistable |
| 3 | `qbSync getCustomerStats` succeeds | Real round-trip to QBO's API works (proves the access token, not just our DB record of it) |
| 4 | `qbWebhook` rejects unsigned POST with 401 | Fail-closed signature guard is active |
| 5 | All QB-pure-helper vitest files pass | Classifier, state machine, payload builders, reconciliation, idempotency, OAuth refresh logic |

---

## 2. DB invariants — paste into Supabase SQL Editor

Run each query. Each should return **0 rows** unless noted.

### 2a. No quote has a legacy fake QB URL stored

```sql
-- The pre-May-9 fabricated URL pattern. resolveCheckoutTarget filters
-- these out at read time so customers can't reach them, but they
-- shouldn't be in the DB at all.
SELECT id, quote_id, qb_payment_link
FROM quotes
WHERE qb_payment_link LIKE '%/portal/asei/CommerceNetwork/consumer/view-invoice%'
ORDER BY created_date DESC;
```

### 2b. Every quote with a `qb_invoice_id` has a usable `qb_payment_link`

```sql
-- A quote with a QB invoice should also have a customer-facing share
-- link. If not, the /send call failed silently — the customer would
-- hit Approve-only on /quotepayment.
-- Allowed exception: quotes synced before 2026-05-18 (the /send-based
-- mint shipped that day; legacy rows from before may legitimately
-- have qb_invoice_id without qb_payment_link).
SELECT id, quote_id, qb_invoice_id, qb_synced_at
FROM quotes
WHERE qb_invoice_id IS NOT NULL
  AND (qb_payment_link IS NULL OR qb_payment_link = '')
  AND qb_synced_at > '2026-05-18'
ORDER BY qb_synced_at DESC;
```

### 2c. Every `qb_payment_link` looks like the real share-link shape

```sql
-- Any URL that doesn't start with the canonical scs- path on
-- connect.intuit.com is suspect. (payments.intuit.com is also valid
-- but rarely returned in practice.)
SELECT id, quote_id, qb_payment_link
FROM quotes
WHERE qb_payment_link IS NOT NULL
  AND qb_payment_link NOT LIKE 'https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-%'
  AND qb_payment_link NOT LIKE 'https://payments.intuit.com/%'
ORDER BY qb_synced_at DESC;
```

### 2d. No duplicate `qb_invoice_id` within a shop

```sql
-- The "numbers match / no duplicate" invariant. Two quote rows
-- pointing at the same QB invoice means we cut a second invoice or
-- linked the wrong row.
SELECT shop_owner, qb_invoice_id, COUNT(*) AS dup_count
FROM quotes
WHERE qb_invoice_id IS NOT NULL
GROUP BY shop_owner, qb_invoice_id
HAVING COUNT(*) > 1;
```

### 2e. Customers added since 2026-05-18 should have `qb_customer_id` (if shop has QB connected)

```sql
-- Audit item #5 fix: qbCustomerSync was silently failing in prod
-- before #181 shipped. Customers added BEFORE that fix may have a
-- null qb_customer_id. They'll auto-backfill on the next edit.
-- This is informational, not failing — just shows the backfill backlog.
SELECT c.shop_owner, COUNT(*) AS unsynced_customers
FROM customers c
JOIN profiles p ON p.shop_owner = c.shop_owner
WHERE c.qb_customer_id IS NULL
  AND p.qb_access_token IS NOT NULL
GROUP BY c.shop_owner
ORDER BY unsynced_customers DESC;
```

---

## 3. Manual UI walkthrough — flows the script can't drive

Mark each ☐ when you've verified it.

### 3a. Send a quote end-to-end

Send a fresh quote to yourself (use `youremail+test1@yourdomain.com` so you can see what the customer sees).

- ☐ Open the quote → click **Send Quote** → modal opens
- ☐ Pick **QuickBooks** as the payment method → click **Create QB Invoice** → wait
- ☐ Modal shows **green "QB invoice #N ready"** badge (NOT amber "QB Payments isn't enabled")
- ☐ **Send** button is enabled
- ☐ Click Send → "Yes, Send" → success banner
- ☐ Check inbox at `youremail+test1@…` — receive ONE InkTracker email + ONE QBO confirmation copy. Both link to the same `connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-…` URL
- ☐ Click the InkTracker email's **Approve & Pay $X** button
- ☐ Lands on `/quotepayment` showing **Approve & Pay $X** + "Secure payment powered by QuickBooks" footer
- ☐ Click Approve & Pay → redirects to QBO portal at `connect.intuit.com/portal/app/...`
- ☐ Portal pre-fills **"Your info → Email" with the customer's real email** (NOT `qb-noop@inktracker.app`)
- ☐ Portal shows card + ACH fields, no Intuit login prompt

### 3b. Quote retry path (`send_failed` state)

Force a failure to confirm the retry UX works.

- ☐ Build a quote with NO customer email set
- ☐ Open Send Quote → pick QB → click Create QB Invoice
- ☐ Expect **red error card** with "Couldn't get the payment link from QuickBooks. Try again…" + a green **Retry — Get Payment Link** button
- ☐ Send button stays **disabled**
- ☐ Close modal, add a valid customer email, reopen
- ☐ Click Retry → goes green/ready

### 3c. Send an invoice (post-completion path)

- ☐ Open an existing **completed** order → preview the invoice
- ☐ If the invoice doesn't have a QB link yet: click **Create in QB** on the InvoiceDetailModal
- ☐ Click **Send Invoice**
- ☐ Modal shows green "QB invoice #N ready" badge
- ☐ Send → customer receives ONE InkTracker email with the styled **Pay Invoice** button (no plain-text "Pay online:" line in front of it)

### 3d. Send Invoice gate (`needs_create` state)

- ☐ Open an invoice that hasn't been pushed to QB yet (no `qb_invoice_id`)
- ☐ Click **Send Invoice**
- ☐ Modal shows **amber prompt**: "This invoice isn't in QuickBooks yet. Close this dialog and click Create in QB first."
- ☐ Send button is **disabled**

### 3e. QB Disconnect + reconnect (the dual-table token clear)

- ☐ Open Account → QuickBooks section → click **Disconnect**
- ☐ Refresh the page → expect "Connect QuickBooks" button (not "View Reports")
- ☐ Run the SQL: `SELECT qb_access_token, qb_refresh_token FROM profile_secrets WHERE profile_id = '<your id>';` → expect both NULL
- ☐ Click Connect → walk through OAuth → land back on Account with success banner
- ☐ Re-run automated script — should now pass checkConnection + getCustomerStats

### 3f. Add a new customer (audit item #5 verification)

- ☐ Customers page → add a fresh test customer
- ☐ Wait 3 seconds, refresh
- ☐ Check the customer row in the DB: `SELECT qb_customer_id FROM customers WHERE name = 'Test ...';` → expect **a value, not null**
- ☐ Open QuickBooks Online → confirm the matching customer exists

### 3g. Webhook end-to-end (the hardest one — needs real payment)

This one's hard to fake without a real card. Skip unless you can spare $1.

- ☐ Build a $1 test quote, send it to yourself, approve+pay in the QBO portal
- ☐ Within ~60 seconds, check the quote row: `status` should flip to `Converted to Order`
- ☐ A new order row should exist with the same `customer_name` + `total: 1`
- ☐ A shop notification should fire (bell icon in the app shows a new unread item)

---

## 4. What "green light" means

| Result | Verdict |
|---|---|
| Script: all 9 pass • SQL: all queries return 0 rows • All 3a-3f manual ☐s checked | 🟢 Green-light. Promote with confidence. |
| Script all pass, SQL queries return 0 rows, but 3g not verified | 🟢 Green-light for everything except the payment-webhook path. Verify 3g when you can. |
| Script: one or two fails • SQL: one query returns rows | 🟡 Investigate before promoting. Fix is usually small but matters. |
| Script: 3+ fails OR webhook fail-closed broken | 🔴 Don't promote. Stop and fix. |

Run this checklist again whenever:
- A QB-touching PR is merged (especially `qbSync` / `qbWebhook` / `qbSendState` / `resolveCheckoutTarget` / `qbCustomerSync`)
- QBO updates their API minor version
- The Resend / Stripe Connect / QuickBooks credentials are rotated
