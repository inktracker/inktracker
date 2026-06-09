# InkTracker — Tester Onboarding

Welcome, and thanks for being one of the first shops outside of Biota to run a real workflow through InkTracker. This is a one-page guide so you can get set up fast, know what to watch out for, and have a direct line to me when something breaks.

## What InkTracker is

A quote → production → invoice → paid workflow for screen-print and embroidery shops, with live garment pricing from S&S and AS Colour, and a two-way QuickBooks Online sync.

## Setup — 10 minutes

1. **Sign up** at https://www.inktracker.app — click "Start free trial" (14 days, no card).
2. **Confirm your email** (check spam if it's slow). The link signs you straight in.
3. **Onboarding wizard** walks you through shop name, tax rate, time zone, and your S&S / AS Colour API keys if you have them.
4. **Connect QuickBooks** under **Account → Integrations → QuickBooks**. OAuth flow opens in a new tab. After approving, you'll land back in InkTracker with the green "Connected" badge.
5. **Turn on 2FA** (strongly recommended): **Account → Security → Enable email sign-in code**. The next time you sign in, you'll get a 6-digit code by email. Tick "Remember this device" if you want to skip the code on your own computer for 30 days.

## Important things to know before you create your first QB invoice

**Creating a QB invoice in InkTracker emails the customer immediately.** QuickBooks Online doesn't have a "silent create" — the only API endpoint that mints the customer payment portal link also sends them the invoice email from QuickBooks' servers. We added confirm dialogs on every "Create Invoice" button to remind you, but I want you to know up front so the first one doesn't surprise you.

If you want to draft an invoice without notifying the customer, do it inside QuickBooks Online directly, then come back to InkTracker — it'll pick the invoice up on the next sync.

## What to test

Whatever your real workflow is. The best feedback is "I did the thing I'd normally do, and X felt wrong / Y was missing / Z was great." Specifically, I'm watching for:

- Quote → send → customer approve & pay → automatic conversion to an order
- QuickBooks invoice creation, customer payment via the QB link, automatic mark-as-paid
- Production scheduling on the Calendar / Production board
- Broker workflow if you do contract work (broker portal, broker pricing)
- Pricing engine accuracy — does it match what you'd quote by hand?

You can't break production data for other shops — multi-tenant isolation is enforced at the database layer. Test as aggressively as you want.

## When something breaks

**Email me directly: joe@biotamfg.co.** Include:

- What you were doing (one sentence)
- What you expected to happen
- What actually happened
- Screenshot if there's an error message
- The time roughly (so I can find it in logs)

I'll usually respond within a few hours during business hours (PT). If it's blocking and urgent, text me — I'll send you my number separately.

## Known rough edges

I'd rather you hear these from me up front than be surprised:

- **No status page yet.** If the app is down, email me — there's no public dashboard to check.
- **Onboarding doesn't deep-link you to QuickBooks setup.** You finish the wizard, then go to Account to connect.
- **QB connection is owner-only.** If you invite a manager or employee, they can't run QB-touching actions directly — the owner's tokens are scoped to the owner profile.
- **Sandbox QuickBooks accounts.** I haven't put a guard against accidentally connecting an Intuit sandbox account. Connect your real production QB.

## What your data is doing

- All shop data is RLS-isolated per shop owner — no other tester can read your customers, quotes, invoices, or QB credentials.
- Your QuickBooks OAuth tokens live in an `extensions`-schema-protected table that only the service role can read; even another user inside your own shop can't pull them.
- 2FA, when enabled, is a real gate — entering the dashboard requires a 6-digit code from your inbox or a trusted-device match.
- Cancellation: export everything as CSV any time from Account → Data Export, including the moment you cancel.

## Cancellation

Sign in → Account → Billing → Cancel. No questions, no holds. Mid-billing-cycle cancellations stay active through the period you've already paid for; trial cancellations end immediately.

---

That's it. Sign up at https://www.inktracker.app, send me your shop's email so I can flag the account, and email me with anything at all.

— Joe / joe@biotamfg.co
