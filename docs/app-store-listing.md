# App Store listing — InkTracker (iOS)

Paste-ready copy + the privacy answers for App Store Connect. **Review the
privacy labels and the App Review note below before submitting — you are
attesting to their accuracy.**

---

## Basics
- **Name:** `InkTracker` (App Store names are globally unique — if taken, use
  `InkTracker — Print Shop` or `InkTracker: Shop Manager`)
- **Subtitle** (30 char max): `Print shop management`
- **Primary category:** Business · **Secondary:** Productivity
- **Bundle ID:** `app.inktracker.mobile`
- **Support URL:** `https://www.inktracker.app`  (or a /support page)
- **Marketing URL:** `https://www.inktracker.app`
- **Privacy Policy URL:** `https://www.inktracker.app/privacy`  (already live)

## Promotional text (170 char max — editable without a new build)
```
Quote, schedule, and invoice screen-print and embroidery jobs from your phone —
with QuickBooks sync, live supplier pricing, and customer approvals built in.
```

## Keywords (100 char max, comma-separated, no spaces)
```
screen printing,print shop,embroidery,order management,quotes,invoicing,quickbooks,production,DTF,apparel
```

## Description
```
InkTracker is the all-in-one management app for screen printing and embroidery
shops. Quote jobs in seconds, keep production moving, invoice with QuickBooks,
and give customers a clean way to approve and pay — all from your phone.

QUOTING & PRICING
• Build accurate quotes for screen print, embroidery, DTF, and more
• Live blank pricing from your suppliers (S&S, AS Colour, SanMar, and others)
• Per-color, per-technique, and rush pricing that matches your shop

ORDERS & PRODUCTION
• Turn approved quotes into orders and track them through the shop floor
• See what's printing, what's due, and what's next at a glance

CUSTOMERS & APPROVALS
• Manage customers, contacts, and job history
• Send art proofs and quotes; customers approve and pay online

INVOICING & ACCOUNTING
• Two-way QuickBooks Online sync — invoices, payments, and expenses stay in step
• Get paid faster with online payment links

INVENTORY & SUPPLIES
• Track your stock and reorder supplies from supplier catalogs in a few taps

BUILT FOR YOUR TEAM
• Roles for owners, managers, employees, and brokers

InkTracker works alongside your account at inktracker.app — sign in with your
existing InkTracker login to pick up right where you left off.
```

## Requires sign-in
The app is a companion to the InkTracker web service. Reviewers need a working
account — provide a **demo login** in App Review Information (see below).

---

## ⚠️ App Review consideration — subscription billing (read this)
InkTracker's $99/mo subscription is billed via **Stripe on the web**, not Apple
In-App Purchase. Apple's guideline 3.1.1 generally requires IAP for digital
subscriptions that unlock in-app functionality — BUT there's a well-trodden path
for B2B SaaS: the app is a **companion to a service purchased elsewhere**, the
app itself **sells nothing** and shows **no pricing, no "subscribe" button, no
upgrade links**. Signing in with an account created + paid on the web is allowed.

To stay on the safe side of review:
- The iOS app must NOT show subscription prices, a "Start trial", "Upgrade", or
  any link that leads to a purchase page. (The web app's billing screens should
  be hidden or read-only on native — this ties into the `isNative()` guard.)
- Account creation + payment happen on the web; the app is sign-in only.
- If Apple pushes back, options are the **External Purchase Link entitlement**
  or treating it as an enterprise/business app. Don't add Apple IAP unless forced
  — a 30% cut on a $99/mo B2B tool is steep.

This is a real, common rejection point — decide the "no purchasing in the app"
stance before submitting. Tracked as a native task: gate billing/upgrade UI
behind `!isNative()`.

---

## App Privacy labels (confirm accuracy before submitting)
Recommended answers based on the current app (Supabase auth, PostHog analytics —
consent-gated, Sentry crash reporting, Stripe billing on web). **Data is NOT
used to track you across other companies' apps/sites** (no ad SDKs) → select
"Data Not Used to Track You".

Data collected and **linked to the user** (all for App Functionality; none for
tracking/ads):
- **Contact Info** — email address, name (account)
- **User Content** — the shop's business data they enter (quotes, customers,
  orders, artwork)
- **Identifiers** — user/account ID
- **Purchases** — subscription status (billing handled by Stripe on the web)

Data collected, **not linked** to identity, for Analytics / App Functionality:
- **Usage Data** — product analytics (PostHog), only after cookie/consent opt-in
- **Diagnostics** — crash data (Sentry)

If any of the above is inaccurate for the iOS build (e.g. analytics disabled on
native), adjust before submitting.

---

## App Review Information (for the reviewer)
- **Sign-in required:** Yes — provide a demo account:
  - Username: `<create a reviewer demo account>`
  - Password: `<...>`
- **Notes:** "InkTracker is a B2B management app for screen-printing shops and a
  companion to the InkTracker web service (inktracker.app). Accounts are created
  and any subscription is paid on the web; the app is sign-in only and sells
  nothing. Use the demo login above to access a populated shop."
