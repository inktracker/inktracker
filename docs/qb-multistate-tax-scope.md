# Multi-State Sales Tax — Full Scope

How sales tax *should* work for a shop that prints in one state and ships across
the country to businesses, and what InkTracker must do to get there. Triggered by
Thunder House (ships nationwide) seeing wrong tax.

> **One-line answer:** QuickBooks Automated Sales Tax (AST) already does multi-state
> tax correctly. InkTracker's job is **not** to compute tax — it's to feed QB the
> right inputs (a structured ship-to address + correct exemption status) and display
> QB's answer. Today InkTracker does neither well, so AST is blind and falls back to
> the shop's home rate.

---

## 1. The root cause (confirmed)

InkTracker sends QuickBooks `ShipAddr: { Line1: <one free-text string> }` — no
structured **City / State / ZIP** (`qbSync/index.ts:943-944`). AST resolves the tax
jurisdiction from `PostalCode` + `CountrySubDivisionCode` (state); with only `Line1`
it can't, so it **falls back to the shop's registered address** and taxes *every*
invoice at the shop's home rate — regardless of where it ships.

Compounding it: the `customers` table has a **single free-text `address`** (no
city/state/zip columns, no separate ship-to), and exemptions are a bare `tax_exempt`
boolean with an unused `tax_id` and no certificate. (`ship_to_address` is referenced
in `lib/tax/quickbooksTaxProvider.js` but that column doesn't exist — the abstraction
is unwired.)

Net effect for Thunder House: out-of-state business orders are taxed at the Reno rate
(or $0 where a customer is flagged exempt), never at the correct destination rate.

---

## 2. How US sales tax actually works (the rules we must honor)

**Nexus — *where* you must collect.** A shop collects/remits tax only in states where
it has nexus:
- **Physical nexus** — office, employees, or inventory in the state.
- **Economic nexus** — exceeding a state's threshold (commonly **$100k in sales or
  200 transactions/yr**, varies by state) creates an obligation even with no physical
  presence.
- **No nexus in the destination state → you do NOT collect tax there.** The buyer may
  owe use tax; that's not the shop's job. So "ship to a no-nexus state" correctly means
  **$0 tax**, not the home rate.

**Sourcing — *which* location's rate.** For interstate shipments, almost all states are
**destination-based**: the rate is the **buyer's ship-to** location. (A handful are
origin-based for *intra*state sales.) A nationwide shipper is overwhelmingly
destination-sourced → **the ship-to address drives everything.**

**The rate is a stack, not a number.** A single ZIP can layer state + county + city +
special-district rates. There are ~11,000 US tax jurisdictions and they change
constantly. This is why a per-shop flat rate is structurally wrong.

**Product taxability varies by state.** Printed apparel is taxable in most states, but
some exempt clothing (e.g. PA, NJ, MN exempt general clothing; NY exempts items under
$110). Decoration/printing labor can be taxed differently than the blank. This is per-
state and per-product-category.

**B2B exemptions — the big one for business customers.**
- **Resale exemption** — a business buying to resell (brokers, other shops, retailers)
  provides a **resale certificate** → no tax. Common in this customer base.
- **Entity exemption** — government, nonprofits, schools → exempt with an **exemption
  certificate**.
- You must **collect and store the certificate** (number + often a PDF), sometimes
  **per state**, to defend the exemption in an audit. A naked `tax_exempt = true` with
  no cert is an audit liability.

**Shipping charges** — taxable or not depending on the state and whether separately
stated.

---

## 3. Division of labor: QB computes, InkTracker feeds + mirrors

| Concern | Owner | Why |
|---|---|---|
| Nexus registration (which states) | **QuickBooks AST** (shop configures) | QB tracks the shop's registrations + economic-nexus warnings |
| Jurisdiction rate stack | **QuickBooks AST** | QB has the ~11k-jurisdiction rate engine, kept current |
| Destination sourcing | **QuickBooks AST** | …*given* a structured ship-to address from us |
| Product taxability | **QuickBooks AST** (via tax categories) | …*given* a category mapping from us |
| Customer exemption | **QuickBooks AST** (via customer/line tax status) | …*given* correct exempt status + line `NON` from us |
| **Structured ship-to address** | **InkTracker** ← gap | QB can't source tax without it |
| **Exemption status + certificate** | **InkTracker** ← gap | feeds QB + audit record |
| **Display the tax the customer will pay** | **InkTracker** ← gap | quote must match the QB invoice they pay |

**InkTracker must stop computing multi-jurisdiction tax itself.** Mirroring an 11k-
jurisdiction engine client-side is a losing game. We feed inputs and show QB's output.

---

## 4. What InkTracker must capture (data-model gaps)

1. **Structured address** on customers — `street, city, state, zip, country` as real
   columns (not one text blob). **State + ZIP is the minimum AST needs.**
2. **Separate bill-to vs ship-to** — B2B often differ; **tax follows ship-to**. Consider
   a **per-order ship-to** too (orders can ship to event/job sites, not the customer's HQ).
3. **Exemption record** — `exempt` + **type** (resale vs entity) + **certificate**
   (number + optional file) + **per-state** where applicable.
4. **Product tax category** — map InkTracker item categories (garment vs decoration) to
   QB tax categories, for states with apparel rules.

---

## 5. What InkTracker must send to QB (write-path fixes)

1. **Structured `ShipAddr`** — `{ Line1, City, CountrySubDivisionCode: <state>, PostalCode,
   Country }`. **This single fix restores correct destination tax for most cases.**
2. **Per-line `TaxCodeRef`** — `TAX`/`NON` honoring customer exemption + product
   taxability. Exemptions go on **lines** (`NON`), never customer-level `Taxable`
   (that 400s in AST companies — see `project_inktracker_qb_tax_exempt`).
3. **Customer tax status** synced to the QB customer where supported.

---

## 6. What InkTracker must display (read-path / quote-time)

The customer **pays the QuickBooks invoice**, so the quote must not promise a different
tax. Two options for the quote-time number:

- **(a) Estimate via QB** before sending — call QB to compute tax for the ship-to
  address so the quoted tax equals the charged tax. Most accurate; more API calls.
- **(b) "Sales tax calculated on final invoice"** — show the subtotal and defer the tax
  to invoice creation (where QB computes it). Simpler; the customer sees final tax at
  pay time. Reasonable for destination tax that genuinely depends on their address.

Either way, **drop the flat `tax_rate` as the source of truth.** Phase 0 (the held-
invoice tripwire, already shipped) guarantees we never silently send a quote whose tax
disagrees with QB until this is in place.

---

## 7. Nexus is a QuickBooks setting (not an InkTracker feature)

The shop declares their nexus states in **QuickBooks → Taxes → Sales Tax Settings**. QB
then collects only where registered and warns on economic-nexus thresholds. InkTracker
should **not** model nexus — it should (a) document that the shop configures it in QB,
(b) add an onboarding nudge, and (c) faithfully reflect QB's result, including a correct
**$0** when shipping to a no-nexus state. If the shop *should* be registered somewhere
and isn't, that's a QB/accountant conversation, surfaced by QB's own nexus alerts.

---

## 8. Phased plan

| Phase | Scope | Outcome |
|---|---|---|
| **0 — shipped (PR #451)** | Hold any invoice where IT's tax ≠ QB's; mirror QB totals back | No customer is silently mis-charged while the rest is built |
| **1 — the core fix** | Structured address (DB + UI) → send structured `ShipAddr` to QB | AST computes correct destination tax. Fixes most of Thunder House's problem |
| **2 — exemptions** | Exemption type + certificate (+ per-state) tracking; line-level `NON` | Defensible B2B/resale/government exemptions |
| **3 — quote-time accuracy** | Estimate via QB, or "calculated on final invoice" | Quoted tax == charged tax; flat `tax_rate` retired |
| **4 — product taxability** | Item-category → QB tax-category mapping | Correct in apparel-exemption states |
| **5 — nexus onboarding** | Docs + onboarding nudge to set nexus states in QB | Shops collect in the right states; correct $0 elsewhere |

---

## 9. Immediate Thunder House triage (before Phase 1 lands)

1. **Add structured ship-to (state + ZIP minimum) to each customer in QuickBooks
   directly** — that lets AST source correctly even before InkTracker sends it.
2. **Verify each flagged exemption has a real certificate** (the fire depts / City of
   Reno are legitimately exempt; confirm and store the cert). Remove `tax_exempt` from
   any customer that isn't actually exempt.
3. **Confirm nexus** — Thunder House collects tax only where they have nexus. Out-of-
   state customers in no-nexus states should be **$0**, not Reno-rate.
4. The Phase-0 hold (PR #451) now **catches any remaining divergence** instead of
   shipping it to the customer.
