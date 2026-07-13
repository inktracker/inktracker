-- BILL-02 gap (2026-07-12 audit): the subscription write gate was appended to
-- the *_owner policies, orders_employee, and purchase_orders_insert/update —
-- but never to the nine manager FOR ALL policies from 20260706000000. Net
-- effect: when a shop's subscription lapses past grace, the OWNER goes
-- read-only while a MANAGER on the same shop can still INSERT/UPDATE quotes,
-- customers, invoices, expenses, inventory, payees, payment accounts, tax
-- categories, and shop_performance directly with their JWT.
--
-- Fix: append has_active_subscription() to the manager policies' WITH CHECK
-- only. USING stays untouched so reads remain open — same read-only-on-lapse
-- contract as the owner gate (see 20260811000000_bill03_past_due_grace.sql).
-- has_active_subscription() already resolves a manager to the shop OWNER's
-- subscription (never the manager's own), so this cannot gate a team member
-- by their own tier.
--
-- Lesson from 20260808000000 applied: ALTER POLICY ... WITH CHECK replaces the
-- ENTIRE expression, so the tenant clause + per-section manager gate are
-- restated verbatim from 20260706000000 before the subscription conjunct.

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
    execute format(
      'alter policy %I on public.%I with check ((%s and public.manager_section_allowed(%L)) and public.has_active_subscription())',
      rec.pol, rec.tbl, mgr_qual, rec.section
    );
  end loop;
end $$;
