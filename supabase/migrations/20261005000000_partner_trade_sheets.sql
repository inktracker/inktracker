-- Partner trade price sheets (docs/shop-partnerships-design.md, Phase 2).
--
-- The shop that DOES the work (the receiver of hand-offs — e.g. an
-- embroiderer) publishes ONE trade rate sheet. When a partner sends them a
-- job, the hand-off's trade price auto-fills from it (decoration priced at
-- the receiver's rates, via the SAME pricing engine — no fork). The sheet is
-- the receiver's own data; a partnered shop may READ it (that's the point —
-- it's a price list offered to partners), but only the owner writes it, and
-- the receiver's full retail pricing_config never crosses (only this resolved
-- decoration sheet does).
create table if not exists partner_trade_sheets (
  shop_owner  text primary key,           -- the shop publishing the sheet
  config      jsonb not null default '{}', -- resolved decoration rate sheet (engine shape)
  updated_at  timestamptz not null default now()
);

-- scale_pct lives in an OWNER-ONLY sidecar, never the partner-readable table.
-- The published config is retail × scale_pct, so a partner who could read
-- scale_pct alongside config would divide it out and recover the receiver's
-- retail decoration rates. Keeping it here (no partner-read policy) means a
-- partner only ever sees the resolved trade rates, never the markup relation.
create table if not exists partner_trade_sheet_meta (
  shop_owner  text primary key,
  scale_pct   numeric,                     -- % of own standard rates (editor continuity)
  updated_at  timestamptz not null default now()
);

alter table partner_trade_sheets enable row level security;
alter table partner_trade_sheet_meta enable row level security;

drop policy if exists partner_trade_sheet_meta_owner on partner_trade_sheet_meta;
create policy partner_trade_sheet_meta_owner on partner_trade_sheet_meta
  for all to authenticated
  using (acts_for_shop(shop_owner))
  with check (acts_for_shop(shop_owner));

-- Owner: full read/write on their own sheet (same as editing their own
-- pricing — not a cross-tenant surface, so authenticated is fine).
drop policy if exists partner_trade_sheets_owner on partner_trade_sheets;
create policy partner_trade_sheets_owner on partner_trade_sheets
  for all to authenticated
  using (acts_for_shop(shop_owner))
  with check (acts_for_shop(shop_owner));

-- Active partner: READ ONLY, and only while an active partnership links us to
-- the sheet's owner. This is the single cross-tenant read in partnerships —
-- deliberately just the published rate sheet, nothing else.
drop policy if exists partner_trade_sheets_partner_read on partner_trade_sheets;
create policy partner_trade_sheets_partner_read on partner_trade_sheets
  for select to authenticated
  using (exists (
    select 1 from shop_partners sp
    where sp.status = 'active'
      and (
        (acts_for_shop(sp.shop_a) and lower(sp.shop_b) = lower(partner_trade_sheets.shop_owner))
        or
        (acts_for_shop(sp.shop_b) and lower(sp.shop_a) = lower(partner_trade_sheets.shop_owner))
      )
  ));

comment on table partner_trade_sheets is
  'Per-shop trade rate sheet a receiver publishes to partners (Phase 2). Owner writes; active partners read. Resolved decoration rates only — never the shop''s full retail pricing_config.';
