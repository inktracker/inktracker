# QuickBooks Setup Checklist — Get Your QB Side Ready

InkTracker connects to your QuickBooks Online in about three clicks. But a few
settings inside QBO itself decide whether invoices, payment links, and tax all
behave the way you expect. Run through this once before (or right after) you
connect — most items take under a minute.

## Before you connect

- [ ] **Sign in as the QBO admin, on your real company.** The OAuth connection
  needs admin permissions, and there's no guard against accidentally connecting
  an Intuit sandbox/test company — make sure the company name in the corner is
  your actual business. (In InkTracker, only the shop owner account can connect
  QB.)

- [ ] **Activate QuickBooks Payments** if you haven't: QBO → ⚙ Settings →
  **Payments** → Get Started. Without it, InkTracker still creates invoices
  fine, but the customer-facing "pay this invoice" link never appears — your
  customer gets an invoice they can't pay online. InkTracker enables both card
  and ACH on every invoice once Payments is active.

- [ ] **Set up sales tax in QBO** (Taxes → Sales tax → Set up) if you charge
  it. InkTracker doesn't push a tax amount — it marks taxable lines and lets
  QBO calculate using *your* tax agency setup. No tax setup in QBO means
  taxable invoices can go out with no tax on them.

## Clean up your customer list

- [ ] **Check customer email addresses.** The invoice email goes to the
  customer's email on file. If it's missing or malformed, the invoice is
  created *without* an email attached and your customer never hears about it —
  no error, just silence.

- [ ] **Merge duplicate customers that share one email.** InkTracker matches
  your InkTracker customer to QB by email address. If two QB customers have
  the same email, the first match wins — glance through your QB customer list
  for known duplicates before your first send.

- [ ] **Mark tax-exempt customers as non-taxable in QB** (customer → Tax info
  → uncheck "This customer is taxable"). InkTracker reads that flag and
  automatically issues their invoices tax-free, even if the quote had a tax
  rate on it.

## Make the invoice look like yours

- [ ] **Customize your invoice template**: QBO → ⚙ Settings → Custom form
  styles. The email your customer receives comes from QuickBooks with your QBO
  branding (logo, colors, message wording) — not from InkTracker. Send
  yourself a test invoice from inside QBO if you want to see it first.

- [ ] **Confirm your company email and name** (⚙ Settings → Account and
  settings → Company) — that's the identity on the invoice emails your
  customers see.

## Things InkTracker handles automatically (nothing to set up)

- **Items**: InkTracker creates service items in QBO as needed (one per
  decoration technique, plus a default "Custom Apparel"). The only
  requirement is that your chart of accounts has an Income account — every
  established QBO company does; only a brand-new empty company might not.
- **Customers**: created in QB automatically if no email match exists.
- **Payment detection**: when your customer pays the QB invoice, InkTracker
  marks the quote paid and converts it to an order — usually within a minute
  (webhook), worst case by the next morning (nightly reconciliation sweep).

## After your first invoice — 2-minute sanity check

1. Create a QB invoice from an InkTracker quote (heads up: **QuickBooks emails
   the customer the moment it's created** — use a quote addressed to your own
   email for this test).
2. In QBO → Sales → Invoices: the invoice is there, numbered with the
   InkTracker quote ID (e.g. `Q-2026-954Z`).
3. Open the emailed invoice: the **Pay invoice** button is present (that's
   QB Payments working) and the tax line matches what you expect.
4. Pay it (or record a payment in QBO) → the InkTracker quote flips to paid
   and converts to an order.

If anything in that sequence doesn't happen, email support@inktracker.app with
the quote number and I'll dig in.

## One maintenance note

QuickBooks connections expire after **100 days of no activity**. If you don't
touch the QB side of InkTracker for 3+ months, the next sync will ask you to
reconnect — Account → QuickBooks → Reconnect, one OAuth round-trip, no data
loss.
