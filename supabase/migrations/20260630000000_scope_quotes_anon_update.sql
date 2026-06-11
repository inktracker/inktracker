-- SECURITY FIX: quotes_anon_update was USING (true) WITH CHECK (true).
--
-- The anon key ships in the client bundle, so any logged-out caller
-- could UPDATE any quote in any shop via the REST API — a cross-tenant
-- write hole (prices, statuses, customer fields, across tenants).
-- Flagged by Supabase Security Advisor (rls_policy_always_true) during
-- Joe's 2026-06-11 scan sweep.
--
-- The public approve/pay/art-approval flows do NOT rely on this policy:
-- they all run through the createCheckoutSession edge function on the
-- service role. Verified no client path calls Quote.update as anon
-- (the authenticated shop-owner UI updates run as `authenticated`, a
-- separate role). So scoping this to the per-quote public_token header
-- — exactly the gate quotes_anon_select_token already uses for reads —
-- closes the hole with zero functional change. A blind cross-tenant
-- update is now impossible; only a caller holding a specific quote's
-- public_token could update that one quote, and even that path isn't
-- currently exercised client-side.

DROP POLICY IF EXISTS quotes_anon_update ON public.quotes;

CREATE POLICY quotes_anon_update ON public.quotes
  FOR UPDATE
  TO anon
  USING (
    public_token IS NOT NULL
    AND public_token = ((current_setting('request.headers', true))::json ->> 'x-public-token')
  )
  WITH CHECK (
    public_token IS NOT NULL
    AND public_token = ((current_setting('request.headers', true))::json ->> 'x-public-token')
  );
