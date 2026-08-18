-- Broker audit 2026-08-17: team policies must not match brokers.
--
-- Brokers carry assigned_shops (that's how their read access to the shop's
-- pricing sheet works), and manager_section_allowed() deliberately returns
-- TRUE for non-managers ("other policies govern"). Four policies keyed ONLY
-- on assigned_shops membership therefore matched brokers too:
--
--   orders_employee        FOR ALL    -> broker read/WRITE/DELETE on every
--                                        order at their assigned shop
--                                        (orders_broker SELECT was meant to
--                                        be their only path)
--   shops_update           FOR UPDATE -> broker could rewrite the SHOP row,
--                                        including pricing_config
--   tax_records_select_own SELECT     -> broker read of the shop's tax records
--   change_log_select_team SELECT     -> broker read of the shop's full
--                                        internal audit trail
--
-- Same class as broker_pricing_manager (20260911000000), which added an
-- explicit role filter for exactly this reason. Role semantics per app
-- design: manager = full partnership; employee = production floor;
-- broker = own quotes/orders only.

-- Orders: managers + employees (floor needs it), never brokers.
-- WITH CHECK keeps has_active_subscription() — the NEW-05 write gate
-- restated in 20261003000000 (managerWriteGate test enforces this; the
-- first draft of this migration dropped it and the test caught it).
-- USING has no subscription gate on purpose: lapsed shops are read-only,
-- not blind (expired-readonly design).
drop policy if exists "orders_employee" on public.orders;
create policy "orders_employee" on public.orders for all to authenticated
using (
  shop_owner in (
    select jsonb_array_elements_text(p.assigned_shops)
    from profiles p
    where p.auth_id = auth.uid()
      and p.assigned_shops is not null
      and p.role in ('manager', 'employee')
  )
  and public.manager_section_allowed('Production')
)
with check (
  (
    shop_owner in (
      select jsonb_array_elements_text(p.assigned_shops)
      from profiles p
      where p.auth_id = auth.uid()
        and p.assigned_shops is not null
        and p.role in ('manager', 'employee')
    )
    and public.manager_section_allowed('Production')
  )
  and public.has_active_subscription()
);

-- Shop row updates: owner or manager only.
drop policy if exists "shops_update" on public.shops;
create policy "shops_update" on public.shops for update to authenticated
using (
  owner_email = (select auth.jwt()) ->> 'email'
  or exists (
    select 1 from profiles
    where profiles.email = (select auth.jwt()) ->> 'email'
      and profiles.assigned_shops @> to_jsonb(shops.owner_email)
      and profiles.role = 'manager'
  )
)
with check (
  owner_email = (select auth.jwt()) ->> 'email'
  or exists (
    select 1 from profiles
    where profiles.email = (select auth.jwt()) ->> 'email'
      and profiles.assigned_shops @> to_jsonb(shops.owner_email)
      and profiles.role = 'manager'
  )
);

-- Tax records: owner or manager (money data; not floor, never brokers).
drop policy if exists "tax_records_select_own" on public.tax_records;
create policy "tax_records_select_own" on public.tax_records for select to authenticated
using (
  shop_owner = (select auth.jwt()) ->> 'email'
  or exists (
    select 1 from profiles
    where profiles.email = (select auth.jwt()) ->> 'email'
      and profiles.assigned_shops @> to_jsonb(tax_records.shop_owner)
      and profiles.role = 'manager'
  )
);

-- Change log (activity feed): shop team = managers + employees, not brokers.
drop policy if exists "change_log_select_team" on public.change_log;
create policy "change_log_select_team" on public.change_log for select to authenticated
using (
  shop_owner in (
    select jsonb_array_elements_text(p.assigned_shops)
    from profiles p
    where p.auth_id = auth.uid()
      and p.assigned_shops is not null
      and p.role in ('manager', 'employee')
  )
);
