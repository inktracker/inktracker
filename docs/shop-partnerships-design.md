# Shop Partnerships — Design (2026-08-14)

Peer shops subcontract to each other: a print shop sends embroidery to an
embroidery shop and vice versa, each keeping the customer relationship and
margin on work they source out. Driving case: Biota (printing) ↔ Front St.
Embroidery (Pete Stull). Both are full shop accounts; **no broker account,
no new role**.

Strategic note: every partnership invite recruits a *complementary* shop
onto the platform (printers invite embroiderers and vice versa). This is
the network-effect lever for a $99/mo product with no acquisition budget.

## Why not the broker model

Brokers are one-directional resellers with a separate non-shop role,
`assigned_shops` scoping, and whole-quote pricing. Partnerships are
symmetric, both parties are shops, and sourcing is **per line item**
(shirts mine, hats yours). The broker machinery isn't reused as-is, but
three of its patterns are: per-counterparty price overrides
(`broker_pricing`, #652), dual price layers on one line item
(`_ppp` vs `_client_*` stamping), and customer-facing field discipline
(`toCustomerFacingQuote`).

## Principles

1. **Tenant isolation stays sacred.** No cross-tenant RLS grants. Every
   hand-off crosses tenants through ONE service-role edge function
   (`partnerHandoff`, the `reportDiscrepancy` pattern), with consent
   recorded on both sides. Nothing else reads across shops.
2. **Blind by default.** The receiving shop sees specs, art, quantities,
   due date, and the trade price — never the sending shop's customer or
   retail pricing. Sharing customer identity is per-hand-off opt-in.
   (Shops guard customer lists; this is the make-or-break trust rule.)
3. **A hand-off is an offer, not an assignment.** Receiver accepts,
   declines, or counters the due date. Nothing lands on their production
   board without acceptance.
4. **Money rides existing rails.** The receiving shop bills the sending
   shop as an ordinary CUSTOMER through the normal quote→invoice→QB flow.
   Zero new payment code; the QB hardening (holds, drift scanner,
   deposits) applies unchanged.
5. **Snapshot discipline** (deposit-path lesson): the agreed trade price
   is stamped at acceptance (`agreed_trade_total`, per-line
   `agreed_trade_ppp`). Later sheet changes never reprice accepted work.
6. **Artwork crosses by COPY, not shared access.** The hand-off function
   copies referenced storage objects into the receiver's tenant (new
   object + `artwork_objects` row). Never loosen the artwork RLS
   (equality-join redesign, #574).

## Data model

```
shop_partners
  id uuid pk
  shop_a text  -- owner email (invite sender)
  shop_b text  -- owner email (invite recipient)
  status text  -- 'invited' | 'active' | 'ended'
  specialties_a text[] / specialties_b text[]   -- display only, v1
  created_at, accepted_at
  unique (least(shop_a,shop_b), greatest(shop_a,shop_b))

partner_handoffs
  id uuid pk
  sending_shop text, receiving_shop text
  source_order_id text          -- sender's order
  source_line_ids text[]        -- which lines were sourced out
  receiving_order_id text null  -- receiver's order (set on accept)
  status text  -- 'offered' | 'accepted' | 'declined' | 'countered'
               --  | 'in_production' | 'completed' | 'cancelled'
  blind boolean default true
  due_date date, counter_due_date date null
  agreed_trade_total numeric null   -- SNAPSHOT at acceptance
  spec jsonb    -- portable job payload (see below)
  created_at, accepted_at, completed_at

partner_price_sheets      -- PHASE 2
  id uuid pk
  owner_shop text        -- whose prices these are
  partner_shop text      -- who they're offered to
  mode text              -- 'percent_off_retail' | 'fixed_sheet'
  percent_off numeric null
  sheet jsonb null       -- per-decoration-method rates (mirrors the
                         --  broker_pricing shape from #652)
  updated_at
```

RLS: `shop_partners` readable/writable by either party (own-email match);
`partner_handoffs` readable by both parties, WRITTEN only by the
service-role edge function; `partner_price_sheets` written by owner_shop,
readable by partner_shop.

### The portable spec (`partner_handoffs.spec`)

Orders are already self-contained JSONB — `line_items` with sizes,
imprints (location/colors/stitch tier/pantones/dimensions), and artwork
refs. The spec is the SANITIZED subset: selected lines with garment
style/color/sizes + imprint details + copied artwork paths + job notes
written for the partner. Sanitizer is a pure `_shared` module
(`partnerSpec.js`) with tests, stripping: customer identity, retail
pricing stamps (`_ppp`, `_client_*`, `clientPpp`), internal notes,
cost fields — same discipline (and test style) as `publicSafe.js`.

## Flows

### Phase 1 — MVP (hand-off without price sheets)

1. **Invite** (Account → Partners): enter email → if the address is an
   InkTracker shop, they get a bell + email; if not, a referral invite
   ("Biota MFG wants to send you embroidery work — set up your shop").
   Accept → `active`.
2. **Send to partner** (OrderDetailModal): pick partner, pick lines,
   blind toggle (default on), REQUIRED trade price you've agreed offline
   (v1: typed manually; Phase 2 auto-fills), note, due date →
   `partnerHandoff` edge fn creates the offer + bell/email to receiver.
   An order can be **split across multiple partners** — different lines to
   different shops — but no single LINE may be out to two live hand-offs at
   once (edge-fn overlap check + the Send-to-Partner UI locks committed
   lines). Artwork is NOT copied here.
3. **Accept/decline** (receiver, new Partners inbox card on Dashboard):
   accept → a guarded compare-and-swap (`offered→accepted`) wins the race
   BEFORE the order is created, so two concurrent accepts can't mint two
   orders; then artwork is copied into the receiver's tenant (ownership-
   gated against `artwork_objects`, so a tampered ref can't pull another
   tenant's file), and service-role creates a real order in their shop
   (via the EDGE builder — parity lesson from the deposit audit: ONE
   builder, tested), customer name = sending shop ("Biota MFG"),
   `partner_handoff_id` backlink. It flows through their Production/
   ShopFloor untouched. **Due-date counter is deferred to a later phase**
   (see below) — v1 is accept/decline; date negotiation is partner-to-
   partner. Receiver orders are money-locked to the snapshot so the Edit
   Order recompute can't collapse the trade total.
4. **Status mirror**: receiver's order status changes write a
   `partner_status` chip onto the sender's order (change_log + the
   existing realtime channel; sender's OrderStatus page for THEIR
   customer stays unified — the customer never sees the partner).
   Completion → bell + email to sender.
5. **Billing (documented pattern, zero new code)**: receiver adds the
   sending shop as a customer and invoices the `agreed_trade_total`
   through the normal flow. The UI nudges this: on completion, the
   receiver's side shows "Invoice Biota MFG $450 →" prefilled via the
   existing invoice-create path.
6. **Job costing**: the sender's order stores `partner_cost` and
   `partner_status` as AGGREGATES over all the order's hand-offs
   (`refresh_order_partner_rollup` — one SQL function, shared by the mirror
   trigger and the edge-fn accept path). `partner_cost` = Σ agreed trade
   totals across accepted/in-production/completed hand-offs; `partner_status`
   = the least-advanced active chip (so "completed" only when every partner
   is done). Performance/job P&L shows revenue − partner cost.

### Phase 2 — trade price sheets (broker-style margins)

**Phase 2a — trade sheet + hand-off auto-fill (SHIPPED 2026-08-14, #772 + #773):**
- The receiver publishes trade rates in Account → Partners with the SAME
  flexibility as broker pricing: a DEFAULT sheet (`partner_email='*'`) plus
  per-partner overrides, full per-cell matrices across every decoration
  method (screen print first/additional, embroidery stitch tiers, custom
  techniques), seeded by a Quick Price % of their own standard rates.
- **Who supplies the blanks** is a per-sheet toggle: decoration-only when
  the SENDER supplies (the default), garment-inclusive (garment × the
  receiver's markup) when the receiver does.
- Table `partner_trade_sheets` keyed `(shop_owner, partner_email)` — owner
  writes; an active partner reads ONLY their own row or the `'*'` default
  (never another partner's specific row). Stores the resolved sheet;
  `scale_pct` lives in an owner-only sidecar so a partner can't invert it
  back to retail rates.
- The Send-to-Partner box **pre-fills the trade price from the partner's
  sheet**: the selected lines' DECORATION cost (`printCost`, garment-
  independent) priced through the SAME engine (`calcLinkedLinePrice`) —
  no forked math. The sender can still override; acceptance snapshots it,
  so the invoice-from-snapshot invariant holds. Integrity gate: the
  receiver confirms by accepting.
- Sender's customer invoice is untouched retail (their normal flow).

**Phase 2b — quote-time line sourcing (DEFERRED):**
- In the sender's quote editor, a line tagged `source: partner:<shop>`
  gets its COST live from the partner's sheet while RETAIL stays the
  sender's markup — margin visible per line, mixed orders (100 shirts
  self + 50 hats partner) in one quote. Not built yet.

### Phase 3 (later, explicitly deferred)

- Partner discovery ("find embroiderers"), automatic partner payouts,
  capacity sharing. (Line-level split shipped 2026-08-14, #771.)
- **Due-date counter negotiation.** Cut from the MVP: it needs a sender-
  side accept/reject surface and an outbound-hand-off view that don't
  exist yet, and the half-built version let a receiver bind the sender to
  a date they never approved. v1 is accept/decline; the schema keeps
  `counter_due_date` (unused) so the flow can be added without a
  migration. Also deferred with it: a sender "cancel this offer" UI
  (`cancelHandoff` exists and is CAS-guarded, just not yet surfaced).

## Edge cases & guards (first pass — audit before build)

- Partner declines after sender already quoted the customer → sender
  warned; hand-off can be re-offered to another partner; order edit
  warnings if trade cost changes the margin materially.
- Sender edits the order after acceptance → receiver's job does NOT
  auto-change (their commitment is the accepted spec); sender gets the
  same class of warning as deposit/edit interplay; re-offer flow for
  material changes.
- Cancellations both directions; receiver's shortfall/discrepancy
  reports mirror to the sender (reuse the floor-report bridge).
- The receiving shop's subscription lapses mid-job → hand-offs pause
  with honest state on both sides.
- Comped/trial shops can partner (it's a growth loop) but the invite
  email to non-users must not overpromise ("free to receive jobs during
  trial" wording — product call).
- pullInvoices / drift scanner: partner invoices are ORDINARY invoices
  in each tenant — no scanner changes needed (verify in audit).

## Open product decisions (Joe)

1. Blind-mode default: per-hand-off toggle (proposed) vs per-partner
   setting?
2. Does acceptance require a trade price, or can shops run "invoice me
   whatever later" hand-offs (v1 manual price is optional → propose
   REQUIRED, to keep the snapshot invariant meaningful)?
3. Referral invite copy + whether a non-user invitee gets an extended
   trial (growth lever).
4. Naming: "Partners" vs "Network" in the UI.

## Build order

1. Migration + `shop_partners` + invite/accept UI (small).
2. `partnerSpec.js` sanitizer + tests (pure).
3. `partnerHandoff` edge fn (offer/accept/decline/status-mirror)
   + artwork copy-on-accept + bells/emails.
4. Sender "Send to partner" UI + receiver inbox card.
5. Completion → prefilled invoice nudge + `partner_cost` on sender.
6. Adversarial audits (tenant isolation, blind-mode leaks, money) —
   same five-angle pattern as the deposit path.
7. Phase 2 sheets after MVP feedback from the live Biota ↔ Front St.
   pair.
