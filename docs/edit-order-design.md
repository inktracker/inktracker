# Edit Order — design

**Status:** DRAFT for Joe's review · 2026-08-06
**Driver:** repeated shop requests for "better ways to modify open orders."
The duplicate-and-switch bug (#735) was the sharpest instance; the underlying
gap is that orders are effectively immutable after conversion — the shop's
only tools are editing the source quote (which the order no longer reads),
reordering (a new quote), or deleting the order (which reverts the quote).
Real shops change quantities, sizes, garments, dates, and occasionally the
customer, after work has started.

## The invariant this must not break

The quote-snapshot invariant says a sold price is a recorded agreement:
nothing recomputes or rewrites as-sold money silently. Editing an order is
not an exception to that rule — it is a **new agreement**, made explicitly,
recorded loudly. Every design choice below follows from that framing:

- Edits **recompute deliberately** and show the money delta before saving.
- Linked documents (quote, invoice, QuickBooks) are **never silently
  rewritten** — each cascade is explicit, mirroring Match-to-QuickBooks.
- The change_log triggers (20260911) record every field change with actor —
  the audit side is already built.

## Lifecycle tiers — what is editable when

The order's linked-document state, not its status label, is what gates
editing. Four tiers, checked in order:

### Tier 1 — Unbilled (no invoice row, no QB invoice)
Full edit: line items (garments, sizes, quantities, imprints), customer,
dates, notes, press/operator (already editable), discounts/extras.
- Pricing: on any line change, recompute via the SAVED shop pricing config
  (same engine as the quote editor) and show `old total → new total` in the
  save confirmation. Saving stamps fresh `_ppp`/`_lineTotal` — the new
  as-sold snapshot.
- Customer switch: the #735 `customerSnapshotPatch` rule applies — every
  snapshot field follows the new customer, token-carrying artifacts
  (art-approval link) are re-minted.

### Tier 2 — Invoiced locally, not in QB
**DECIDED (Joe, 2026-08-06): auto-update.** Saving an order edit rewrites
the linked invoice's lines/totals to match — no per-save prompt. The
record lives in two places:
- change_log rows on BOTH documents (trigger-written, with actor), and
- a dated line appended to the invoice's shop-facing notes — same
  pattern as buildSyncNote's QB audit lines:
  `[2026-08-06] Updated from order edit: total $500.00 → $560.00`.
  stripSyncNotes-style filtering keeps it OFF customer-facing surfaces
  (PDF, QB CustomerMemo); it's the shop's paper trail, not the client's.

### Tier 3 — In QuickBooks (qb_invoice_id set), unpaid
Money edits allowed but the save flow ends with an explicit **"Push update
to QuickBooks"** step that reuses the existing qbSync update path
(authoritative re-read + UPDATE of the existing QB invoice — the same
machinery createInvoice already uses for resyncs, including the tax
re-estimate and the hold-on-mismatch gate).
- If the shop declines the push, the order carries a visible
  `QB out of date` badge until pushed (same consent philosophy as
  Match-to-QuickBooks, in the opposite direction).
- Customer switch in this tier is **blocked** — a QB invoice belongs to a
  QB customer; switching means void-in-QB + recreate, which is Tier-4
  territory and phase 2 at the earliest.

### Tier 4 — Paid (fully or deposit) or Completed
Locked for money edits. Production fields (dates, press, operator, notes,
step data) stay editable — they never were money. The affordance offered
instead:
- Paid: "Bill the difference" → a NEW invoice for the delta (additional
  charges), or a credit note path (phase 3; QB credit memos are their own
  project).
- Completed: Reorder (exists) — a finished job is history, history doesn't
  change (performance stats already counted it).

## Production side-effects (the non-money hazards)

These are why "just make lines editable" corrupts state quietly:

1. **Goods progress** is keyed per line per size (`orderGoodsProgress`).
   Editing sizes/quantities after goods are marked ordered/received must
   reconcile the counts: reducing a size below its received count blocks
   with "3 received > 2 ordered — adjust received first"; adding sizes
   resets that size's progress to unordered. Never silently drop received
   goods records.
2. **Shortfall** (`_shortfall` per line) — same rule: shortfall can't
   exceed the new quantity; block or clamp with confirmation.
3. **POs** (`source_order_id`): if a draft/submitted PO exists, editing
   garment lines shows "PO #X was built from this order's previous
   quantities" with a link — we do NOT auto-edit POs (a submitted PO is a
   real-world commitment).
4. **Art approval**: changing imprints/artwork after `art_approved` clears
   the approval and tells the shop the customer must re-approve (the
   approval was for the old art). Changing only quantities keeps it.

## Concurrency

The stale-write guard (from the larger-shop backlog) ships WITH this
feature, not after it: the editor records `updated_at`-equivalent state at
open (change_log's latest id for the order works today, no schema change),
and save re-reads the row — if it moved, show "Changed by {actor} while
you were editing" with a diff, block the blind overwrite. Editing orders
is exactly where two-CSR clobbering will happen first.

## UI

One `OrderEditorModal` reusing the quote editor's building blocks
(`LineItemEditor`, the pricing engine, `customerSnapshotPatch`) — not a
fork of QuoteEditorModal (the 5-forked-header lesson). Entry: an **Edit**
button on OrderDetailModal, permission-gated to owner/manager with the
Production section; hide_money users never see money deltas (they also
can't reach money edits — Tier 1 money editing requires seeing money).

## Phasing

- **Phase 1** (bulk of the value, least risk): Tiers 1-2 + production
  side-effect guards + concurrency guard + change_log everywhere. No QB
  writes at all.
- **Phase 2**: Tier 3 QB push (reuses existing qbSync update path; the
  reconcile/tax-hold machinery already exists).
- **Phase 3**: Tier 4 bill-the-difference / credit notes; QB customer
  switch (void+recreate).

## Open product questions for Joe

1. ~~Tier 2 default~~ — **ANSWERED: auto-update, record in shop-facing
   notes** (see Tier 2 above).
2. Should employees (floor) ever edit quantities (misprint reality), or is
   that owner/manager only? Current shortfall flow gives the floor a
   controlled path already — doc assumes edits stay owner/manager.
3. Paid orders: is "bill the difference" the actual shop expectation, or
   do shops mostly want to edit BEFORE billing (making Tier 4 rare enough
   to defer entirely)?
4. Does editing an order update the SOURCE QUOTE too? Doc says NO — the
   quote is the historical agreement that produced the order; the order is
   the living document. The quote gets a one-line change_log entry
   ("superseded by order edit") for the paper trail.
