-- RLS performance: wrap bare auth.*() calls in (select ...) so Postgres
-- evaluates them ONCE per query (an InitPlan) instead of once PER ROW.
--
-- This is the Supabase-recommended, result-IDENTICAL fix for the
-- `auth_rls_initplan` advisor. `auth.uid()` / `auth.jwt()` are STABLE, so
-- `(select auth.uid())` returns the same value — only the evaluation timing
-- changes. At 4 shops it's invisible; at onboarding scale (per-shop RLS scans
-- of large tables) it's the single biggest RLS perf win. No policy is dropped,
-- no roles/commands change, tenant isolation is byte-for-byte the same.
--
-- Mechanical + idempotent: for every public policy whose USING / WITH CHECK
-- still contains a BARE auth.<fn>() (not already wrapped in a select), rewrite
-- ONLY the auth call via ALTER POLICY (atomic — the policy is never absent).
-- The regex matches exactly the same 57 policies verified by hand against the
-- advisor output. The "already wrapped" guard is case-INSENSITIVE (!~*) because
-- Postgres re-renders the applied expression as `( SELECT auth.uid())` (upper),
-- so re-running is a true no-op (never double-wraps). Extra WITH CHECK
-- conditions (has_active_subscription(), manager_section_allowed(...)) are
-- preserved verbatim — only the auth call inside them is wrapped.
--
-- Verify after: `select count(*) from pg_policies where schemaname='public' and
-- ((qual ~ 'auth\.(uid|jwt|role|email)\(\)' and qual !~* '\(\s*select\s+auth\.')
-- or (with_check ~ 'auth\.(uid|jwt|role|email)\(\)' and with_check !~
-- '\(\s*select\s+auth\.'))` returns 0, and the perf advisor's
-- auth_rls_initplan count drops to 0.

DO $$
DECLARE
  r record;
  stmt text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check,
           (qual ~ 'auth\.(uid|jwt|role|email)\(\)' AND qual !~* '\(\s*select\s+auth\.') AS qn,
           (with_check ~ 'auth\.(uid|jwt|role|email)\(\)' AND with_check !~* '\(\s*select\s+auth\.') AS cn
    FROM pg_policies
    WHERE schemaname = 'public'
      AND ((qual ~ 'auth\.(uid|jwt|role|email)\(\)' AND qual !~* '\(\s*select\s+auth\.')
        OR (with_check ~ 'auth\.(uid|jwt|role|email)\(\)' AND with_check !~* '\(\s*select\s+auth\.'))
    ORDER BY tablename, policyname
  LOOP
    stmt := 'ALTER POLICY ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename);
    IF r.qn THEN
      stmt := stmt || ' USING (' ||
        regexp_replace(r.qual, 'auth\.(uid|jwt|role|email)\(\)', '(select auth.\1())', 'g') || ')';
    END IF;
    IF r.cn THEN
      stmt := stmt || ' WITH CHECK (' ||
        regexp_replace(r.with_check, 'auth\.(uid|jwt|role|email)\(\)', '(select auth.\1())', 'g') || ')';
    END IF;
    EXECUTE stmt;
    n := n + 1;
    RAISE NOTICE 'rls_initplan: rewrote %.%', r.tablename, r.policyname;
  END LOOP;
  RAISE NOTICE 'rls_initplan: % policies rewritten', n;
END $$;
