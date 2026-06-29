-- RL-05: stop anon/authenticated from calling the rate-limiter RPCs directly.
--
-- check_request_rate / check_anon_email_rate / check_supplier_lookup_rate were
-- granted to anon + authenticated. Because the increment happens BEFORE the
-- check, a hostile client holding the public anon key can call them directly
-- with someone else's key to POISON a victim's bucket — locking a shop's wizard
-- or a customer's payment page out without any traffic of their own.
--
-- Every legitimate caller is an edge function using the SERVICE-ROLE client, so
-- the limiters only need service_role execute. Grant service_role explicitly
-- FIRST (check_supplier_lookup_rate never had an explicit service_role grant —
-- it rode the `authenticated` grant we're about to remove), THEN revoke
-- anon/authenticated. Order matters so the edge functions never lose access.
--
-- No frontend code calls these RPCs (verified), so revoking is transparent to
-- the app. "Fail-open on RPC error" in the supplier-lookup functions is an
-- intentional availability tradeoff and is left as-is; this change removes the
-- poisoning vector, which is the actual vulnerability.

GRANT EXECUTE ON FUNCTION public.check_request_rate(text, integer)         TO service_role;
GRANT EXECUTE ON FUNCTION public.check_anon_email_rate(text, integer)      TO service_role;
GRANT EXECUTE ON FUNCTION public.check_supplier_lookup_rate(text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_request_rate(text, integer)         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_anon_email_rate(text, integer)      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_supplier_lookup_rate(text, integer) FROM anon, authenticated;
