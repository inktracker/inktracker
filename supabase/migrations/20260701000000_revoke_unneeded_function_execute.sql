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
REVOKE EXECUTE ON FUNCTION public.get_quote_by_token(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_order_by_token(text) FROM anon, authenticated;

-- ── Trigger functions — never meant as RPCs ─────────────────────────
-- These fire from triggers, which run as the table owner regardless of
-- who holds EXECUTE on the function name. Revoking the RPC-callable
-- grant changes nothing about the triggers; it just removes a callable
-- entry point.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cascade_performance_on_order_delete() FROM anon, authenticated;
