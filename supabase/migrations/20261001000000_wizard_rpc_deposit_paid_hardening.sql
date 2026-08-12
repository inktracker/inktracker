-- ============================================================================
-- SECURITY HARDENING (deposit path): the wizard RPC no longer accepts
-- deposit_paid from the anonymous payload.
-- ============================================================================
-- With deposits COLLECTIBLE (docs/deposit-path-design.md), a forged
-- deposit_paid=true on an anon wizard submission would make qbSync
-- auto-post a phantom QB Payment (money never received) when the shop
-- invoices the job. "Paid" is set only by the QB webhook/reconcile after
-- real money lands, or by the shop's own manual toggle.
--
-- This migration re-issues the CURRENT live body (20260823000000, with all
-- three anti-bot guards, server-owned totals, shop-exists check, and the
-- deposit_pct clamp) changing exactly one value: deposit_paid inserts as
-- literal FALSE instead of COALESCE(payload).
--
-- ROLLBACK: re-apply 20260823000000_wizard_rpc_restore_bot_guards.sql.

CREATE OR REPLACE FUNCTION public.submit_wizard_quote(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id       uuid;
  v_shop_owner text;
  v_honeypot   text;
  v_dwell_ms   bigint;
  v_recent_n   int;
BEGIN
  v_shop_owner := payload->>'shop_owner';
  IF v_shop_owner IS NULL OR v_shop_owner = '' THEN
    RAISE EXCEPTION 'shop_owner is required';
  END IF;

  -- Shop must actually exist.
  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE owner_email = v_shop_owner) THEN
    RAISE EXCEPTION 'unknown shop';
  END IF;

  IF octet_length(payload::text) > 204800 THEN
    RAISE EXCEPTION 'payload too large';
  END IF;

  -- ── Anti-bot guard 1: honeypot ─────────────────────────────────────
  -- The wizard renders an off-screen input real users never fill; naive
  -- form-filling bots tick it. Generic error so a persistent attacker
  -- can't tell which signal caught them.
  v_honeypot := COALESCE(payload->>'_bot_honeypot', '');
  IF length(trim(v_honeypot)) > 0 THEN
    RAISE EXCEPTION 'request rejected';
  END IF;

  -- ── Anti-bot guard 2: dwell time ───────────────────────────────────
  -- < 3s between page-open and submit is humanly impossible for a
  -- multi-section quote form. Bots routinely submit in under 100ms.
  v_dwell_ms := COALESCE((payload->>'_bot_dwell_ms')::bigint, 0);
  IF v_dwell_ms < 3000 THEN
    RAISE EXCEPTION 'request rejected';
  END IF;

  -- ── Anti-bot guard 3: per-shop rate limit ──────────────────────────
  -- No single shop legitimately receives >30 wizard submissions/hour.
  -- Caps a sustained spam attack's blast radius to 30/hour.
  SELECT COUNT(*) INTO v_recent_n
  FROM public.quotes
  WHERE shop_owner = v_shop_owner
    AND source = 'wizard'
    AND created_at > NOW() - INTERVAL '1 hour';
  IF v_recent_n >= 30 THEN
    RAISE EXCEPTION 'rate limit exceeded — try again later';
  END IF;

  -- ── Insert (server owns subtotal/tax/total; anon inputs clamped) ────
  INSERT INTO public.quotes (
    shop_owner, source, status, quote_id, customer_name, customer_email,
    phone, company, date, due_date, notes, rush_rate, extras, line_items,
    selected_artwork, tax_exempt, tax_id, discount, tax_rate, deposit_pct,
    deposit_paid, subtotal, tax, total
  )
  VALUES (
    v_shop_owner,
    'wizard',                                                       -- forced
    'Pending',                                                      -- forced
    payload->>'quote_id',
    payload->>'customer_name',
    payload->>'customer_email',
    payload->>'phone',
    payload->>'company',
    NULLIF(payload->>'date', '')::date,
    NULLIF(payload->>'due_date', '')::date,
    payload->>'notes',
    GREATEST(0, COALESCE((payload->>'rush_rate')::numeric, 0)),
    COALESCE(payload->'extras', '{}'::jsonb),
    COALESCE(payload->'line_items', '[]'::jsonb),
    COALESCE(payload->'selected_artwork', '[]'::jsonb),
    COALESCE((payload->>'tax_exempt')::boolean, false),
    payload->>'tax_id',
    GREATEST(0, COALESCE((payload->>'discount')::numeric, 0)),     -- no negative discount
    GREATEST(0, COALESCE((payload->>'tax_rate')::numeric, 0)),     -- no negative tax
    LEAST(100, GREATEST(0, COALESCE((payload->>'deposit_pct')::numeric, 0))), -- clamp 0..100
    FALSE, -- deposit_paid: never from the anon payload (deposit-path hardening)
    NULL,   -- subtotal: server-owned (recomputed); never trust the anon payload
    NULL,   -- tax:      server-owned
    NULL    -- total:    server-owned
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
-- Grants mirror 20260824000000_wizard_rpc_service_role_only (the source
-- 20260823 body predates that lockdown and re-granting browser roles here
-- would silently reopen direct-RPC access — caught by wizardRpcGrant.test).
REVOKE EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO service_role;
