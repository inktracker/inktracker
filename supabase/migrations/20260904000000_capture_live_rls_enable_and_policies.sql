-- Durability capture (2026-07-13): reconcile migration-vs-prod RLS drift.
--
-- Two out-of-band changes existed in production but in NO migration, so a
-- rebuild-from-migrations (the restore-drill / DR path) would silently produce
-- a DIFFERENT, less-safe database:
--
--   1. RLS was ENABLED on 19 core tenant tables directly in the dashboard.
--      Their POLICIES are defined in migrations (20260501_rls_lockdown.sql and
--      later), but a policy without `ENABLE ROW LEVEL SECURITY` is INERT — a
--      rebuilt DB would have every one of these tables WIDE OPEN (all rows
--      readable/writable by any authenticated user). This is the single most
--      dangerous drift item.
--
--   2. Two policies were created out-of-band and appear in no migration:
--        - quotes_broker_write : lets a broker create/edit their own quotes
--          (the broker portal's submit-to-shop flow). Without it a rebuilt DB
--          silently breaks all broker quote creation.
--        - orders_anon_select_token : lets the anonymous order-status page read
--          an order via its public_token.
--
-- Verified against prod via pg_policies / pg_class on 2026-07-13. All statements
-- are idempotent: ENABLE on an already-enabled table is a no-op, and the two
-- policies are DROP-IF-EXISTS first. Running this against prod changes nothing;
-- running it in a fresh rebuild makes the rebuild match prod.

-- ── 1. Enable RLS on the core tenant tables whose ENABLE lived only in prod ──
do $$
declare
  t text;
  tbls text[] := array[
    'broker_documents','broker_files','broker_notifications','broker_performance',
    'commissions','customers','expenses','inventory_items','invoices','messages',
    'mfa_audit_log','orders','payees','payment_accounts','profiles','quotes',
    'shop_performance','shops','tax_categories'
  ];
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- ── 2a. Broker quote-write policy (ALL) — broker owns rows keyed by broker_id ─
drop policy if exists quotes_broker_write on public.quotes;
create policy quotes_broker_write on public.quotes
  for all to authenticated
  using  (broker_id = (auth.jwt() ->> 'email'))
  with check (broker_id = (auth.jwt() ->> 'email'));

-- ── 2b. Anonymous order-status read via public_token (SELECT) ────────────────
drop policy if exists orders_anon_select_token on public.orders;
create policy orders_anon_select_token on public.orders
  for select to anon
  using (
    public_token is not null
    and public_token = ((current_setting('request.headers', true))::json ->> 'x-public-token')
  );
