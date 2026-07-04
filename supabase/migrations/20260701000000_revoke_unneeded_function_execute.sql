-- Revoke EXECUTE on SECURITY DEFINER functions from roles that never
-- legitimately call them. Flagged by Supabase Security Advisor
-- (anon/authenticated_security_definer_function_executable) in Joe's
-- 2026-06-11 scan sweep, then verified per-function before revoking.
--
-- Each revoke below is proven safe by call-site analysis:
--   * not called by the client (no supabase.rpc(...) in src/), AND
--   * not referenced by any RLS policy for the revoked role.
-- So the grant served no purpose and was pure attack surface.

-- ── Broker relationship helpers — the real finding ──────────────────
-- broker_shop_owner_values_for(p_shop_email) leaked broker emails +
-- broker↔shop assignments to ANY anon caller who guessed a shop email
-- (low severity: no customer/financial/token data, but a genuine
-- enumeration vector). Both are used ONLY in `authenticated` RLS
-- policies (customers, profiles, purchase_orders) — anon never needs
-- them. Keep authenticated; drop anon.
REVOKE EXECUTE ON FUNCTION public.broker_shop_owner_values_for(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assigned_shop_emails_for(uuid)     FROM anon;

-- ── Token lookups — edge-function-only ──────────────────────────────
-- get_quote_by_token / get_order_by_token are called only by edge
-- functions on the service role (not client-called, not in any RLS
-- policy). Neither anon nor authenticated needs EXECUTE.
-- restore-drill guard (2026-07-03): these functions were dashboard-created
-- (never in a migration) and on a fresh replay don't exist yet — they're
-- recreated by 20260831000000_out_of_band_capture.sql, which re-applies
-- these exact revokes after creating them. Live-DB semantics unchanged.
DO $$ BEGIN REVOKE EXECUTE ON FUNCTION public.get_quote_by_token(text) FROM anon, authenticated; EXCEPTION WHEN undefined_function THEN NULL; END $$;
DO $$ BEGIN REVOKE EXECUTE ON FUNCTION public.get_order_by_token(text) FROM anon, authenticated; EXCEPTION WHEN undefined_function THEN NULL; END $$;

-- ── Trigger functions — never meant as RPCs ─────────────────────────
-- These fire from triggers, which run as the table owner regardless of
-- who holds EXECUTE on the function name. Revoking the RPC-callable
-- grant changes nothing about the triggers; it just removes a callable
-- entry point.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM anon, authenticated;
DO $$ BEGIN REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                     FROM anon, authenticated; EXCEPTION WHEN undefined_function THEN NULL; END $$;
REVOKE EXECUTE ON FUNCTION public.cascade_performance_on_order_delete() FROM anon, authenticated;
