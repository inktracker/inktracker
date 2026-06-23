-- Finding A (2026-06 adversarial review): the anonymous public wizard could
-- read the ENTIRE shops table. A dashboard-created SELECT policy on shops
-- granted the `anon` role with USING (true), so anyone holding the bundled
-- anon key could enumerate every shop's owner_email, stripe_account_id /
-- stripe_account_status, quote email templates, presses, and production_tasks:
--
--   GET /rest/v1/shops?select=owner_email,stripe_account_id,shop_name
--   -> returned all shops' rows.
--
-- The public wizard (src/pages/QuoteRequest.jsx) no longer reads `shops`
-- directly. It now fetches a SAFE, wizard-only column subset through the
-- getPublicShopConfig edge function (service role), so anon no longer needs
-- ANY direct read access to shops.
--
-- DEPLOY ORDER MATTERS: getPublicShopConfig must be deployed and the frontend
-- shipped BEFORE this migration runs, or the wizard loses its config source.
--
-- This drops every policy on public.shops that grants the `anon` role
-- (name-agnostic — the leaking policy was created in the dashboard with an
-- unknown name). Authenticated owner/manager/broker access via the
-- `shops_select` policy is untouched.

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT polname
    FROM pg_policy
    WHERE polrelid = 'public.shops'::regclass
      AND EXISTS (
        SELECT 1 FROM pg_roles r
        WHERE r.rolname = 'anon'
          AND r.oid = ANY (polroles)
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.shops', pol.polname);
    RAISE NOTICE 'Dropped anon-granting policy % on public.shops', pol.polname;
  END LOOP;
END $$;

-- Belt-and-suspenders: revoke table-level grants from anon so even a future
-- accidental permissive policy can't expose the table to anonymous clients.
REVOKE ALL ON public.shops FROM anon;
