-- Per-partner trade sheets (docs/shop-partnerships-design.md, Phase 2a).
--
-- Supersedes the single-sheet-per-shop model from 20261005 (zero rows in
-- prod — safe to recreate). Like broker pricing, a shop can now set a DEFAULT
-- partner sheet AND per-partner overrides: give one embroiderer different
-- rates than another. partner_email = '*' is the default that applies to any
-- partner without a specific row.
--
-- The sheet also records who supplies the blanks (config.receiver_supplies_
-- garments): decoration-only pricing when the SENDER supplies, garment-
-- inclusive when the receiver does.

-- Safety: the drop/recreate below is only lossless while the 20261005 tables
-- are empty (verified zero rows in prod at deploy). Abort rather than silently
-- destroy a saved default sheet if that ever stops being true.
do $$
begin
  if to_regclass('public.partner_trade_sheets') is not null
     and (select count(*) from public.partner_trade_sheets) > 0 then
    raise exception 'partner_trade_sheets has rows — migrate data (add partner_email default ''*'') instead of dropping';
  end if;
end $$;

drop policy if exists partner_trade_sheets_owner on partner_trade_sheets;
drop policy if exists partner_trade_sheets_partner_read on partner_trade_sheets;
drop policy if exists partner_trade_sheet_meta_owner on partner_trade_sheet_meta;
drop table if exists partner_trade_sheets;
drop table if exists partner_trade_sheet_meta;

create table partner_trade_sheets (
  shop_owner    text not null,             -- the shop publishing the sheet
  partner_email text not null default '*', -- '*' = default for all partners
  config        jsonb not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (shop_owner, partner_email)
);

-- scale_pct stays OWNER-ONLY (config = retail × scale, so exposing scale lets a
-- partner invert to retail rates). Keyed per sheet.
create table partner_trade_sheet_meta (
  shop_owner    text not null,
  partner_email text not null default '*',
  scale_pct     numeric,
  updated_at    timestamptz not null default now(),
  primary key (shop_owner, partner_email)
);

alter table partner_trade_sheets     enable row level security;
alter table partner_trade_sheet_meta enable row level security;

-- Owner: full read/write on their own sheets (any partner_email).
create policy partner_trade_sheets_owner on partner_trade_sheets
  for all to authenticated
  using (acts_for_shop(shop_owner))
  with check (acts_for_shop(shop_owner));

create policy partner_trade_sheet_meta_owner on partner_trade_sheet_meta
  for all to authenticated
  using (acts_for_shop(shop_owner))
  with check (acts_for_shop(shop_owner));

-- Active partner: READ ONLY, and only the row that applies to THEM — their own
-- specific row or the '*' default — and only while actively partnered with the
-- sheet's owner. Never another partner's specific row.
create policy partner_trade_sheets_partner_read on partner_trade_sheets
  for select to authenticated
  using (
    (partner_email = '*' or acts_for_shop(partner_email))
    and exists (
      select 1 from shop_partners sp
      where sp.status = 'active'
        and (
          (acts_for_shop(sp.shop_a) and lower(sp.shop_b) = lower(partner_trade_sheets.shop_owner))
          or
          (acts_for_shop(sp.shop_b) and lower(sp.shop_a) = lower(partner_trade_sheets.shop_owner))
        )
    )
  );

comment on table partner_trade_sheets is
  'Per-partner trade rate sheets (Phase 2a). Owner writes; an active partner reads only their own row or the ''*'' default. Resolved decoration (and optionally garment) rates — never the shop''s full retail pricing_config.';
