-- Wizard RPC — anti-bot + rate-limit safeguards
--
-- The public quote wizard is the only customer-facing write path on
-- inktracker. Without a gate, a hostile bot can blast `submit_wizard_quote`
-- and pollute the shop's queue with garbage rows. This migration adds
-- three tripwires inside the SECURITY DEFINER function so the protection
-- holds even when a client bypasses the JS-side checks.
--
--   (1) Honeypot field. The wizard renders an off-screen text input
--       (`company_website`) that real users can't see but naive form-
--       filling bots tick. If the payload's `_bot_honeypot` is non-
--       empty, reject. The error message is intentionally generic so a
--       persistent attacker can't reverse-engineer which signal caught
--       them.
--
--   (2) Dwell-time floor. The wizard captures `Date.now()` on mount
--       and sends the elapsed millis as `_bot_dwell_ms` at submit.
--       Any value under 3 seconds gets refused — a real human can't
--       configure a garment + contact details in that window. Bots
--       routinely submit in under 100ms.
--
--   (3) Per-shop rate limit. No single shop should receive more than
--       30 wizard submissions per hour under normal conditions. If the
--       count exceeds that, we refuse further submissions until the
--       hour rolls. Caps the blast radius of a sustained attack to
--       30/hour rather than thousands/minute.
--
-- All three guards run BEFORE the INSERT, so abusive payloads don't
-- create rows at all. Successful submissions still land as
-- status='Pending' / source='wizard' exactly as before, and are
-- quarantined to the Wizard tab on the shop's Quotes page (UI change
-- in src/pages/Quotes.jsx — wizard quotes never appear in All /
-- Internal views).

CREATE OR REPLACE FUNCTION public.submit_wizard_quote(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id        uuid;
  v_shop_owner  text;
  v_honeypot    text;
  v_dwell_ms    bigint;
  v_recent_n    int;
BEGIN
  v_shop_owner := payload->>'shop_owner';
  IF v_shop_owner IS NULL OR v_shop_owner = '' THEN
    RAISE EXCEPTION 'shop_owner is required';
  END IF;

  -- Defensive size guard. The wizard sends modest payloads (~10 KB
  -- typical); 200 KB is well above realistic submissions and well
  -- below abusive spam.
  IF octet_length(payload::text) > 204800 THEN
    RAISE EXCEPTION 'payload too large';
  END IF;

  -- ── Anti-bot guard 1: honeypot ─────────────────────────────────────
  -- If the off-screen input was filled, the caller is almost certainly
  -- a bot. Generic error so the bot can't iterate around the gate.
  v_honeypot := COALESCE(payload->>'_bot_honeypot', '');
  IF length(trim(v_honeypot)) > 0 THEN
    RAISE EXCEPTION 'request rejected';
  END IF;

  -- ── Anti-bot guard 2: dwell time ───────────────────────────────────
  -- < 3 seconds between page open and submit is humanly impossible
  -- for a multi-section quote form. Same generic error.
  v_dwell_ms := COALESCE((payload->>'_bot_dwell_ms')::bigint, 0);
  IF v_dwell_ms < 3000 THEN
    RAISE EXCEPTION 'request rejected';
  END IF;

  -- ── Anti-bot guard 3: per-shop rate limit ──────────────────────────
  -- Count wizard submissions to this shop in the last hour. 30 is well
  -- above the legitimate ceiling (a busy shop might get 5-10/day) and
  -- still aggressive enough to choke a sustained spam attack.
  SELECT COUNT(*) INTO v_recent_n
  FROM public.quotes
  WHERE shop_owner = v_shop_owner
    AND source = 'wizard'
    AND created_at > NOW() - INTERVAL '1 hour';
  IF v_recent_n >= 30 THEN
    RAISE EXCEPTION 'rate limit exceeded — try again later';
  END IF;

  -- ── Insert ────────────────────────────────────────────────────────
  INSERT INTO public.quotes (
    shop_owner,
    source,
    status,
    quote_id,
    customer_name,
    customer_email,
    phone,
    company,
    date,
    due_date,
    notes,
    rush_rate,
    extras,
    line_items,
    selected_artwork,
    tax_exempt,
    tax_id,
    discount,
    tax_rate,
    deposit_pct,
    deposit_paid,
    subtotal,
    tax,
    total
  )
  VALUES (
    v_shop_owner,
    'wizard',                                                       -- forced
    'Pending',                                                      -- forced (no Approved-by-anon)
    payload->>'quote_id',
    payload->>'customer_name',
    payload->>'customer_email',
    payload->>'phone',
    payload->>'company',
    NULLIF(payload->>'date', '')::date,
    NULLIF(payload->>'due_date', '')::date,
    payload->>'notes',
    COALESCE((payload->>'rush_rate')::numeric, 0),
    COALESCE(payload->'extras', '{}'::jsonb),
    COALESCE(payload->'line_items', '[]'::jsonb),
    COALESCE(payload->'selected_artwork', '[]'::jsonb),
    COALESCE((payload->>'tax_exempt')::boolean, false),
    payload->>'tax_id',
    COALESCE((payload->>'discount')::numeric, 0),
    COALESCE((payload->>'tax_rate')::numeric, 0),
    COALESCE((payload->>'deposit_pct')::numeric, 0),
    COALESCE((payload->>'deposit_paid')::boolean, false),
    NULLIF(payload->>'subtotal', '')::numeric,
    NULLIF(payload->>'tax', '')::numeric,
    NULLIF(payload->>'total', '')::numeric
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Permissions unchanged from prior migration but re-apply for safety.
REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO anon, authenticated;
