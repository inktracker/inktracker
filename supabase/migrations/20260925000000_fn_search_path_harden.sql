-- Pin an explicit empty search_path on the one function that lacked one, per
-- the function_search_path_mutable advisor. Defense-in-depth: a fixed
-- search_path can't be hijacked by a caller's session search_path to shadow an
-- unqualified name. This trigger only calls NOW() (a pg_catalog builtin, always
-- in scope) and touches the NEW tuple, so search_path = '' is fully safe — no
-- behavior change, the trigger keeps firing exactly as before.
--
-- It's SECURITY INVOKER (not DEFINER) so the practical risk was minimal, but
-- this clears the last mutable-search_path warning and hardens it if the body
-- ever grows or the function is later made DEFINER.

ALTER FUNCTION public.touch_supplier_order_idempotency_updated_at()
  SET search_path = '';
