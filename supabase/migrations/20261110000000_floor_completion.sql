-- Floor completion hand-back (2026-09-22). Joe: "can floor mode just move it
-- to complete and it goes back to admin for invoicing or whatever it needs?"
--
-- Shop Floor's "Mark Complete" now stamps status='Completed' +
-- completed_date + floor_completed_at, and does NOT create the invoice /
-- performance rows. The office sees a "Needs invoicing" flag on the order
-- and finishes it with the existing Create Invoice action (runOrderCompletion
-- clears floor_completed_at). Revenue stats already read orders.completed_date
-- and dedupe against shop_performance by order_id, so a floor-completed order
-- counts immediately.
--
-- This also lets us take back the invoice / performance write access that
-- 20261109000000 gave employees for the old "floor runs full completion"
-- model. Employees keep SELECT on customers (floor shows real names).

alter table public.orders
  add column if not exists floor_completed_at timestamptz;

drop policy if exists "invoices_employee_select" on public.invoices;
drop policy if exists "invoices_employee_insert" on public.invoices;
drop policy if exists "shop_performance_employee_select" on public.shop_performance;
drop policy if exists "shop_performance_employee_insert" on public.shop_performance;
drop policy if exists "broker_performance_employee_insert" on public.broker_performance;
drop policy if exists "broker_files_employee_insert" on public.broker_files;
