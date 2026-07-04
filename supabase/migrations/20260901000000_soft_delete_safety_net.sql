-- ─────────────────────────────────────────────────────────────────────────
-- T5: soft-delete safety net on the four highest-value tables —
-- quotes, orders, invoices, customers.
--
-- WHY: no PITR on the free tier means an accidental delete is simply gone
-- between nightly exports. Deletes from the app now set deleted_at instead
-- (src/api/supabaseClient.js), rows stay recoverable for the purge window
-- (30 days — .github/workflows/purge-soft-deleted.yml), and clients cannot
-- hard-delete at all.
--
-- DIVISION OF LABOR (validated in the restore drill):
--   • WRITE-protection is RLS — RESTRICTIVE policies, pure AND on top of
--     the existing permissive (tenancy) policies, which are untouched:
--     already-deleted rows can't be edited or un-deleted by clients, and
--     client hard-DELETE is refused outright.
--   • READ-filtering is the entity wrapper (src/api/supabaseClient.js) —
--     every app read goes through it, and it appends deleted_at IS NULL
--     on these four tables. A restrictive SELECT policy was tried first
--     and REJECTED: Postgres applies restrictive SELECT policies as check
--     options on UPDATE, which blocks the soft-delete write itself
--     (caught by scripts/restore-drill/verify-soft-delete.mjs). A
--     hand-rolled authenticated query can still read its OWN tenant's
--     recycle bin — that's the user's own data, not an isolation gap.
-- service_role BYPASSRLS is untouched: edge functions and the purge job
-- see everything, and the service-role read paths that serve
-- customer-facing links add explicit deleted_at guards in code.
--
-- DEPLOY ORDER: this migration MUST be applied before the frontend/edge
-- code that writes or filters deleted_at ships (42703 otherwise).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes','orders','invoices','customers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    -- Partial index: the purge job's scan + "recycle bin" listings touch
    -- only the deleted slice; live-row reads pay nothing.
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (deleted_at) WHERE deleted_at IS NOT NULL',
                   t || '_deleted_at_idx', t);

    -- Visible (live) rows can be updated — including TO the deleted state
    -- (that's the soft-delete write). Already-deleted rows are untouchable:
    -- USING filters them out, and WITH CHECK (true) delegates new-row
    -- validation entirely to the permissive tenancy policies.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_edit_soft_deleted', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (deleted_at IS NULL) WITH CHECK (true)',
      t || '_no_edit_soft_deleted', t);

    -- Clients never hard-delete these tables again. The app soft-deletes;
    -- the purge job (service role) is the only hard-delete path.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_client_hard_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false)',
      t || '_no_client_hard_delete', t);
  END LOOP;
END $$;

-- Parity with 20260516_preserve_completed_orders.sql: hard-deleting a
-- Completed order is refused, so SOFT-deleting one must be refused too —
-- otherwise the UPDATE path quietly bypasses the historical-record guard.
CREATE OR REPLACE FUNCTION public.refuse_completed_order_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND OLD.status = 'Completed' THEN
    RAISE EXCEPTION
      'Cannot delete a Completed order (order_id: %, customer: %). Completed orders are preserved as historical records.',
      OLD.order_id, OLD.customer_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS refuse_completed_order_soft_delete_trg ON public.orders;
CREATE TRIGGER refuse_completed_order_soft_delete_trg
  BEFORE UPDATE OF deleted_at ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_completed_order_soft_delete();

-- The integrity oracle counts LIVE rows only: a soft-deleted row awaiting
-- purge is recycle-bin content, not a live-data violation. (Deleting a
-- CUSTOMER that live rows still reference WILL alarm after the customer is
-- purged — that's a real dangling link and exactly what the alarm is for;
-- the purge job also refuses to purge customers that live rows reference.)
CREATE OR REPLACE FUNCTION public.data_integrity_violations()
RETURNS TABLE(tbl text, missing_link bigint, dangling_link bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'invoices'::text,
         count(*) FILTER (WHERE i.customer_id IS NULL OR i.customer_id = ''),
         count(*) FILTER (WHERE i.customer_id IS NOT NULL AND i.customer_id <> '' AND c.id IS NULL)
  FROM invoices i LEFT JOIN customers c ON c.id::text = i.customer_id
  WHERE i.deleted_at IS NULL
  UNION ALL
  SELECT 'quotes',
         count(*) FILTER (WHERE q.customer_id IS NULL OR q.customer_id = ''),
         count(*) FILTER (WHERE q.customer_id IS NOT NULL AND q.customer_id <> '' AND c.id IS NULL)
  FROM quotes q LEFT JOIN customers c ON c.id::text = q.customer_id
  WHERE q.deleted_at IS NULL
  UNION ALL
  SELECT 'orders',
         count(*) FILTER (WHERE o.customer_id IS NULL OR o.customer_id = ''),
         count(*) FILTER (WHERE o.customer_id IS NOT NULL AND o.customer_id <> '' AND c.id IS NULL)
  FROM orders o LEFT JOIN customers c ON c.id::text = o.customer_id
  WHERE o.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.data_integrity_violations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_integrity_violations() TO service_role;
