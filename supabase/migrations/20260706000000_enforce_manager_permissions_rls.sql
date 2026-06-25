-- Finding B (2026-06 adversarial review): manager_permissions was a UI-only
-- gate. The owner could hide sections (Invoices, Customers, …) from a manager
-- in the sidebar, but RLS still scoped managers by shop only — so a manager
-- could query a "hidden" table directly with their JWT and read everything.
--
-- This enforces the per-section gate in RLS for every manager-policy table that
-- maps cleanly to a gateable section. A SECURITY DEFINER helper reads the
-- caller's manager_permissions and returns false only when the caller is a
-- manager whose permissions explicitly set that section to false. For owners,
-- employees, brokers, anon, and managers with NULL permissions (the default —
-- BOTH current live managers are NULL, so this migration changes nothing for
-- them) it returns true, leaving their existing access untouched.
--
-- Sections that intentionally stay UI-only (no clean row-level mapping):
--   * Dashboard   — aggregate landing view, no table of its own
--   * Mockups     — no dedicated table
--   * Pricing     — lives in shops.pricing_config; column-level, and the shops
--                   row also carries shop_name/branding the layout always needs,
--                   so it can't be row-gated per manager without breaking the UI
-- These remain enforced in the client (managerCanAccess / nav), which is fine:
-- the sensitive data behind them (invoices, customers, performance) IS gated
-- below, so a manager can't reach the underlying records anyway.

-- ── Helper ──────────────────────────────────────────────────────────────────
create or replace function public.manager_section_allowed(section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (p.manager_permissions is null)
            or ((p.manager_permissions ->> section) is distinct from 'false')
     from profiles p
     where p.auth_id = auth.uid() and p.role = 'manager'
     limit 1),
    true);  -- not a manager (or no profile) → don't block; other policies govern
$$;

revoke all on function public.manager_section_allowed(text) from public;
grant execute on function public.manager_section_allowed(text) to authenticated;

-- ── Manager [ALL] policies: append the section gate to USING + WITH CHECK ─────
-- Canonical manager subquery + per-table section.
do $$
declare
  mgr_qual text := $q$shop_owner in (
    select jsonb_array_elements_text(p.assigned_shops)
    from profiles p
    where p.auth_id = auth.uid() and p.assigned_shops is not null and p.role = 'manager'
  )$q$;
  rec record;
begin
  for rec in
    select * from (values
      ('quotes',           'quotes_manager',           'Quotes'),
      ('customers',        'customers_manager',        'Customers'),
      ('invoices',         'invoices_manager',         'Invoices'),
      ('payees',           'payees_manager',           'Invoices'),
      ('payment_accounts', 'payment_accounts_manager', 'Invoices'),
      ('tax_categories',   'tax_categories_manager',   'Invoices'),
      ('expenses',         'expenses_manager',         'Performance'),
      ('shop_performance', 'shop_performance_manager', 'Performance'),
      ('inventory_items',  'inventory_items_manager',  'Inventory')
    ) as t(tbl, pol, section)
  loop
    execute format('drop policy if exists %I on public.%I', rec.pol, rec.tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (%s and public.manager_section_allowed(%L)) with check (%s and public.manager_section_allowed(%L))',
      rec.pol, rec.tbl, mgr_qual, rec.section, mgr_qual, rec.section
    );
  end loop;
end $$;

-- ── orders: managers ride the shared orders_employee policy (no role filter).
-- Gate it on 'Production'. Employees (role<>'manager') get TRUE from the helper,
-- so their access is unchanged.
drop policy if exists "orders_employee" on public.orders;
create policy "orders_employee" on public.orders for all to authenticated
using (
  shop_owner in (
    select jsonb_array_elements_text(p.assigned_shops)
    from profiles p
    where p.auth_id = auth.uid() and p.assigned_shops is not null
  )
  and public.manager_section_allowed('Production')
)
with check (
  shop_owner in (
    select jsonb_array_elements_text(p.assigned_shops)
    from profiles p
    where p.auth_id = auth.uid() and p.assigned_shops is not null
  )
  and public.manager_section_allowed('Production')
);

-- ── purchase_orders: 4 per-command policies share the owner-OR-assigned shape.
-- Gate each on 'Inventory'. Owner/employee branches get TRUE from the helper.
do $$
declare
  po_qual text := $q$(
    shop_owner = (select profiles.email from profiles where profiles.auth_id = auth.uid())
    or shop_owner in (select assigned_shop_emails_for(auth.uid()))
  )$q$;
begin
  execute format('drop policy if exists %I on public.purchase_orders', 'purchase_orders_select');
  execute format('create policy %I on public.purchase_orders for select to authenticated using (%s and public.manager_section_allowed(%L))',
    'purchase_orders_select', po_qual, 'Inventory');

  execute format('drop policy if exists %I on public.purchase_orders', 'purchase_orders_insert');
  execute format('create policy %I on public.purchase_orders for insert to authenticated with check (%s and public.manager_section_allowed(%L))',
    'purchase_orders_insert', po_qual, 'Inventory');

  execute format('drop policy if exists %I on public.purchase_orders', 'purchase_orders_update');
  execute format('create policy %I on public.purchase_orders for update to authenticated using (%s and public.manager_section_allowed(%L)) with check (%s and public.manager_section_allowed(%L))',
    'purchase_orders_update', po_qual, 'Inventory', po_qual, 'Inventory');

  execute format('drop policy if exists %I on public.purchase_orders', 'purchase_orders_delete');
  execute format('create policy %I on public.purchase_orders for delete to authenticated using (%s and public.manager_section_allowed(%L))',
    'purchase_orders_delete', po_qual, 'Inventory');
end $$;
