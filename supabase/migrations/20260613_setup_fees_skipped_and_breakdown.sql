-- Multi-fee setup billing — add per-quote skip list + saved breakdown.
--
-- Builds on 20260612_quote_setup_fees: the shop now defines a *list*
-- of named per-screen fees (Screens / Film / Color Match / etc.) instead
-- of a single rate. Each quote can:
--   - skip specific fees (e.g. design doesn't need Color Match)
--   - render an itemized "Setup" block on customer/broker views without
--     re-resolving against the shop's current pricing config (which may
--     have drifted since the quote was sent — snapshot invariant)
--
-- Columns:
--   setup_skipped_fee_ids   text[]. Fee ids the user excluded on this
--                           quote. Empty array = bill every active fee.
--   setup_fee_breakdown     jsonb. Per-fee snapshot at save time:
--                             {
--                               "screens": 4,
--                               "items": [
--                                 { "id":"screens", "label":"Screens", "rate":25, "total":100 },
--                                 { "id":"film",    "label":"Film",    "rate":10, "total":40  }
--                               ]
--                             }
--                           setup_total (already on the table) is still
--                           the canonical billable; this is for display.

alter table quotes
  add column if not exists setup_skipped_fee_ids text[] not null default '{}',
  add column if not exists setup_fee_breakdown   jsonb;

alter table orders
  add column if not exists setup_skipped_fee_ids text[] not null default '{}',
  add column if not exists setup_fee_breakdown   jsonb;

comment on column quotes.setup_skipped_fee_ids is
  'Fee ids excluded from this quote''s setup billing. Empty = all active shop fees apply.';
comment on column quotes.setup_fee_breakdown is
  'Per-fee snapshot at save time for itemized display. setup_total remains the canonical billable.';
