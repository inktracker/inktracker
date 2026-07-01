-- ============================================================================
-- SECURITY FIX: restore the wizard RPC's anti-bot guards (regressed by drift).
-- ============================================================================
-- The public wizard is the only anonymous write path on InkTracker. Migration
-- 20260606170000 added three server-side tripwires inside submit_wizard_quote
-- (honeypot / dwell-time / per-shop hourly rate limit). Two later migrations
-- that recreated the function for unrelated reasons — 20260710020000
-- (shop-exists guard) and 20260711000000 (force server-owned totals) — were
-- built from the PRE-guard body, silently dropping all three. Net effect:
-- reCAPTCHA v3 became the SOLE bot gate, while wizardSubmit/index.ts +
-- src/lib/wizardSubmit.js still claim the RPC enforces these checks.
--
-- This migration merges the three guards back on top of the CURRENT live body
-- (keeping the forced-NULL subtotal/tax/total and the discount/tax/deposit
-- clamps from 20260711000000, and the shop-exists check from 20260710020000).
-- Guards run BEFORE the INSERT, so rejected payloads create no rows. Successful
-- submissions are unchanged (status='Pending' / source='wizard').
--
-- ROLLBACK: re-apply 20260711000000_wizard_rpc_force_server_totals.sql to drop
-- the guards again (restores the guard-less body).
-- ============================================================================

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
    COALESCE((payload->>'deposit_paid')::boolean, false),
    NULL,   -- subtotal: server-owned (recomputed); never trust the anon payload
    NULL,   -- tax:      server-owned
    NULL    -- total:    server-owned
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO anon, authenticated;
