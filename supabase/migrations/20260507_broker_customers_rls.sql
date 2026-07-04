-- Allow brokers to manage their own customers (shop_owner = 'broker:' || email)
-- restore-drill fix (2026-07-03): the original `'broker:' || auth.jwt()->>'email'`
-- is invalid SQL — Postgres left-associates `||` before `->>`, so it tries
-- jsonb-concat on the text literal and errors. The LIVE policy (per
-- `supabase db dump`) uses concat() with explicit grouping; this file now
-- matches what production actually runs. Tenancy predicate unchanged.
CREATE POLICY "customers_broker" ON customers FOR ALL TO authenticated
  USING (shop_owner = concat('broker:', auth.jwt()->>'email'))
  WITH CHECK (shop_owner = concat('broker:', auth.jwt()->>'email'));
