# QuickBooks Setup Checklist — Get Your QB Side Ready

> **Live version: https://www.inktracker.app/qb-setup** (rendered by
> `src/pages/QbSetup.jsx`, linked from Account → QuickBooks). That page is
> canonical — if integration behavior changes, update both it and this file.

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

## Connected late? Found duplicate customers?

If you used InkTracker (or QuickBooks) for a while before connecting the two,
you may end up with duplicate customers — the same person under a business
name on one side and a personal name on the other. The rule that keeps this
simple: **QuickBooks is the book of record — merge duplicates there.**

1. In QBO, merge the duplicates (edit the duplicate customer and set its
   Display Name to exactly match the one you're keeping — QBO consolidates
   their transactions safely).
2. Back in InkTracker, open the Customers page. InkTracker detects the QB-side
   merge automatically and shows a banner offering a one-click finish — it
   combines your local records the same way, moving every quote, order, and
   invoice to the surviving customer. Nothing is deleted until everything has
   moved.

Day to day, duplicates are prevented at the source: InkTracker matches
customers to QB by email, so keeping emails accurate (the checklist above)
means invoices land on the right QB customer instead of minting a new one.

## Need an invoice in QB without emailing the customer?

Creating an invoice from InkTracker always emails the customer — that's an
Intuit constraint, not ours. The customer-facing payment link is minted by
QuickBooks' send endpoint, and that endpoint always sends the email with it.
There's no "create the pay link silently" option in the QuickBooks API.

**The workaround:** draft the invoice inside QuickBooks Online directly (QBO
saves without sending), review it, and hit send from QBO whenever you're
ready — the payment link and email go out at that moment. InkTracker picks
the invoice up on its next sync, and when your customer pays, the quote still
converts to an order automatically.

## One maintenance note

QuickBooks connections expire after **100 days of no activity**. If you don't
touch the QB side of InkTracker for 3+ months, the next sync will ask you to
reconnect — Account → QuickBooks → Reconnect, one OAuth round-trip, no data
loss.
