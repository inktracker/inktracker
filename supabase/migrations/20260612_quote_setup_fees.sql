-- Setup fees for screen-print quotes.
--
-- Adds three columns to `quotes` so the per-screen setup fee can be
-- snapshotted alongside subtotal/tax/total at save time, plus the
-- per-quote knobs that drive it.
--
-- Per the snapshot invariant (Memory > Quote Snapshot Invariant): viewers
-- read saved fields, no live recompute. Setup is part of the saved
-- breakdown — `setup_total` is stamped on save and rendered directly.
--
-- Columns:
--   setup_screens_override   nullable int. When set, used instead of the
--                            auto-derived screen count (sum of imp.colors
--                            across unique imprint print-keys). Lets the
--                            shop pair screens or correct edge cases from
--                            the quote editor.
--   is_reorder               bool. When true, uses the cheaper reorder
--                            per-screen rate from pricing_config.setupFees
--                            (screens already exist from the first run).
--   setup_total              numeric. Saved snapshot of screens × rate at
--                            quote save time. Default 0 so existing quotes
--                            without setup fees continue to read the same
--                            totals.

alter table quotes
  add column if not exists setup_screens_override integer,
  add column if not exists is_reorder             boolean not null default false,
  add column if not exists setup_total            numeric not null default 0;

-- Mirror on orders since orders carry the saved snapshot forward when a
-- quote converts. Without these, the conversion loses the setup line.
alter table orders
  add column if not exists setup_screens_override integer,
  add column if not exists is_reorder             boolean not null default false,
  add column if not exists setup_total            numeric not null default 0;

comment on column quotes.setup_screens_override is
  'When set, overrides the auto-derived screen count for setup-fee billing. Null = use auto count.';
comment on column quotes.is_reorder is
  'When true, setup fees use the reorder per-screen rate instead of the standard rate.';
comment on column quotes.setup_total is
  'Saved snapshot of screens × per-screen-rate at quote save time.';
