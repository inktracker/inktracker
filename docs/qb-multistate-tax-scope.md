# Multi-State Sales Tax — Full Scope

How sales tax *should* work for a shop that prints in one state and ships across
the country to businesses, and what InkTracker must do to get there. Triggered by
Thunder House (ships nationwide) seeing wrong tax.

> **One-line answer:** InkTracker should **never compute tax itself**. It delegates to a
> tax *authority* — QuickBooks AST for QB-connected shops, a dedicated tax engine (Stripe
> Tax / Avalara / TaxJar) for shops without QB — feeds it the right inputs (structured
> ship-to + exemption status), applies its answer, and keeps an immutable audit record of
> where the number came from. Today IT does neither: it computes a flat rate locally, and
> on the QB path it starves AST of the address it needs. Both must change.
>
> **Two halves:** §1–7 cover the **QB-connected** path. §8–11 cover the **non-QB** path,
> the **liability stance**, and the **audit-readiness** layer that applies to every shop.

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

## 8. Shops WITHOUT QuickBooks (the other half — was missing)

QB is an optional integration. A shop can quote, invoice, and run its books entirely
in InkTracker. For those shops **InkTracker is the system of record for tax** — there
is no AST behind it. The flat `tax_rate` is *more* dangerous here, not less, because
nothing downstream corrects it. Three possible models:

| Model | What it is | Audit verdict |
|---|---|---|
| **A. Flat rate (today)** | Shop sets one % applied to every customer | **Fails** for any multi-state shop. One rate can't be right for 50 destinations. |
| **B. Manual jurisdiction tables** | Shop maintains per-state/zip rate rows | **Fails in practice** — ~11k jurisdictions, constant changes, human error. An audit-loss machine. |
| **C. Real tax engine (recommended)** | IT integrates a calculation API as the authority | **Passes** — the engine owns rates, sourcing, nexus, product taxability. |

**Recommendation: every shop must sit behind a real tax authority.** Two clean tiers:
- **QB-connected → QuickBooks AST** is the authority (Phases 1–5).
- **Not connected → a dedicated tax engine** is the authority. Candidates:
  - **Stripe Tax** — already in our stack (billing). Natural pairing if/when IT adds a
    Stripe customer-payment rail (note: today QB is the *only* customer-payment path —
    see `project_inktracker_two_stripe_webhooks`). Computes by address incl. nexus.
  - **TaxJar / Avalara** — standalone tax APIs, address-based, exemption-cert handling,
    return-filing reports. Heavier, more complete.

Until a shop is behind QB AST or a tax engine, the flat rate must be treated as a
shop-owned manual override (see §9) — explicitly, not silently.

---

## 9. InkTracker is NEVER the tax authority (the liability stance)

The goal — *shops pass audits and never have reason to blame us* — is met by one
principle: **InkTracker never originates a tax determination. It delegates to an
authority, faithfully applies that authority's number, and stores an immutable record
of where the number came from.** Every path has a named authority:

| Path | Tax authority | IT's job |
|---|---|---|
| QB-connected | QuickBooks AST | feed structured ship-to + exemption; display + record QB's tax |
| Tax-engine | Stripe Tax / Avalara / TaxJar | feed address + line categories; display + record the engine's tax |
| Manual (no integration) | **The shop** (explicit, recorded consent) | apply the rate the shop set; record that the shop set it, when, and that they accepted responsibility |

This must be backed by **Terms language**: the shop is solely responsible for tax
registration, determination, collection, and remittance; InkTracker provides
calculation tools/integrations, does not act as a tax advisor, and does not warrant
tax accuracy. Disclaimer alone is not enough — it only holds up *because* the tool
actually delegates to a real authority and keeps faithful records. (See
`project_security_roadmap` lawyer-pass items.)

---

## 10. Audit-readiness layer (ALL shops, both paths)

A shop passes an audit on **records**, not on a correct rate alone. These apply
regardless of QB/engine/manual:

1. **Immutable per-line tax record** at time of sale: taxable amount, rate, jurisdiction
   breakdown, taxable/exempt flag, **which authority computed it**, and timestamp. Never
   recomputed later (mirrors the quote-snapshot invariant, `project_quote_immutability`).
2. **Exemption certificates** — capture type (resale/entity), certificate number,
   **a stored PDF**, issuing state, and **expiration**; block/flag expired certs. A
   `tax_exempt = true` with no cert on file is an audit liability.
3. **Tax-collected-by-jurisdiction report** — what was collected per state/locality, so
   the shop can file returns. Without this they can't actually remit correctly.
4. **Refund / credit tax reversal** — credits must reverse the *same* tax that was
   charged, recorded as such.
5. **Charged-vs-remitted reconciliation** — and, for QB shops, the Phase-0 hold already
   guarantees IT's record == QB's record.

---

## 11. Edge cases / long tail (enumerate so nothing is silently wrong)

- **Deposits & partial payments** — when is tax due: at deposit, or at final payment?
  (Generally on the full taxable sale; deposits are usually tax-deferred until delivery.)
- **Tax-inclusive vs tax-exclusive** pricing display.
- **Shipping/handling taxability** — per-state, and whether separately stated.
- **Rounding** — line vs invoice rounding; match the authority's method to the cent.
- **Refunds/voids/re-issues** — tax follows the money both directions.
- **International** — Canada (GST/PST/HST) and VAT are a different model entirely; AS
  Colour is AU/NZ-sourced, so flag whether any shop sells outside the US (likely v-next).
- **Tax holidays** and **thresholds** (e.g. NY clothing < $110) — handled by the engine,
  not by us, which is the point.
- **Marketplace facilitator** rules — out of scope unless IT ever collects on shops' behalf.

---

## 12. Phased plan (revised)

| Phase | Scope | Outcome |
|---|---|---|
| **0 — shipped (PR #451)** | Hold any QB invoice where IT's tax ≠ QB's; mirror QB totals back | No customer silently mis-charged on the QB path |
| **1 — structured address** | Address (DB + UI) → structured `ShipAddr` to QB | AST computes correct destination tax. Fixes most of Thunder House's problem |
| **2 — exemptions + certificates** | Type + cert PDF + state + expiry; line-level `NON` | Defensible B2B/resale/government exemptions (audit §10.2) |
| **3 — audit records layer** | Immutable per-line tax record + by-jurisdiction report | Any shop can substantiate + file (audit §10.1, §10.3) |
| **4 — non-QB tax engine** | Integrate Stripe Tax / Avalara / TaxJar as authority for non-QB shops; explicit manual-rate consent UX otherwise | No shop relies on a blind flat rate |
| **5 — quote-time accuracy** | Estimate via the authority, or "calculated on final invoice" | Quoted tax == charged tax; flat `tax_rate` retired |
| **6 — product taxability** | Item-category → tax-category mapping | Correct in apparel-exemption states |
| **7 — nexus onboarding + Terms** | Nexus setup nudge + tax-responsibility ToS language | Shops collect in the right states; liability properly placed |

---

## 13. Immediate Thunder House triage (before Phase 1 lands)

1. **Add structured ship-to (state + ZIP minimum) to each customer in QuickBooks
   directly** — that lets AST source correctly even before InkTracker sends it.
2. **Verify each flagged exemption has a real certificate** (the fire depts / City of
   Reno are legitimately exempt; confirm and store the cert). Remove `tax_exempt` from
   any customer that isn't actually exempt.
3. **Confirm nexus** — Thunder House collects tax only where they have nexus. Out-of-
   state customers in no-nexus states should be **$0**, not Reno-rate.
4. The Phase-0 hold (PR #451) now **catches any remaining divergence** instead of
   shipping it to the customer.
