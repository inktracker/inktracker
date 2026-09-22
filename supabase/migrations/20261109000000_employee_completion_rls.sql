-- Let a shop EMPLOYEE mark an order Completed from the Shop Floor (2026-09-22).
--
-- runOrderCompletion (shared by Orders, Production, Shop Floor) looks up or
-- creates the order's invoice row and writes a shop_performance row (plus
-- broker_performance / broker_files for broker orders). Employees had RLS on
-- orders only, so the floor's "Mark Complete" button failed with "Couldn't
-- complete the order" for anyone who wasn't an owner or manager.
--
-- Scope is deliberately narrow: SELECT + INSERT only (no update/delete), only
-- for shops the employee is assigned to, and only while the Production
-- section is allowed — the same shape as orders_employee. Employees can't
-- reach the Invoices/Performance pages in the UI; this just lets the
-- completion side effects land under the owner's shop.

create or replace function public.employee_assigned_shop(target_shop_owner text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    where p.auth_id = auth.uid()
      and p.assigned_shops is not null
      and p.role in ('manager', 'employee')
      and target_shop_owner in (select jsonb_array_elements_text(p.assigned_shops))
  ) and public.manager_section_allowed('Production');
$$;

-- invoices: read (existing-invoice lookup) + insert (create on completion)
drop policy if exists "invoices_employee_select" on public.invoices;
create policy "invoices_employee_select" on public.invoices for select to authenticated
using (public.employee_assigned_shop(shop_owner));

drop policy if exists "invoices_employee_insert" on public.invoices;
create policy "invoices_employee_insert" on public.invoices for insert to authenticated
with check (public.employee_assigned_shop(shop_owner) and public.has_active_subscription());

-- shop_performance: insert (+ select so the client can read back the row)
drop policy if exists "shop_performance_employee_select" on public.shop_performance;
create policy "shop_performance_employee_select" on public.shop_performance for select to authenticated
using (public.employee_assigned_shop(shop_owner));

drop policy if exists "shop_performance_employee_insert" on public.shop_performance;
create policy "shop_performance_employee_insert" on public.shop_performance for insert to authenticated
with check (public.employee_assigned_shop(shop_owner) and public.has_active_subscription());

-- broker orders completed from the floor: performance row + PDF attachment
drop policy if exists "broker_performance_employee_insert" on public.broker_performance;
create policy "broker_performance_employee_insert" on public.broker_performance for insert to authenticated
with check (public.employee_assigned_shop(shop_owner) and public.has_active_subscription());

drop policy if exists "broker_files_employee_insert" on public.broker_files;
create policy "broker_files_employee_insert" on public.broker_files for insert to authenticated
with check (public.employee_assigned_shop(shop_owner) and public.has_active_subscription());

-- customers: read-only so the floor shows real customer/company names for
-- employees instead of silently falling back (audit item 11).
drop policy if exists "customers_employee_select" on public.customers;
create policy "customers_employee_select" on public.customers for select to authenticated
using (public.employee_assigned_shop(shop_owner));
