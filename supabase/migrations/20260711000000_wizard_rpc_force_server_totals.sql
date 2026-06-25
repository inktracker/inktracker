-- ============================================================================
-- SECURITY FIX (CRITICAL): the public wizard RPC must NOT accept money totals
-- from the anonymous payload.
-- ============================================================================
-- submit_wizard_quote persisted `subtotal`, `tax`, and `total` straight from
-- the anon payload (NULLIF(payload->>'total',...)). The real browser wizard
-- never sends those, so they normally stay NULL and the app recomputes totals
-- live. But a scripted caller can submit `{"total": 0.01}` on a real Pending
-- quote; effectiveQuoteTotals then TRUSTS that saved total (no recompute), and
-- createCheckoutSession charges `client_total ?? total` — i.e. the
-- attacker-chosen amount. A shop that sends a clean wizard lead un-edited would
-- charge whatever the submitter picked.
--
-- Fix: FORCE subtotal/tax/total to NULL (server always owns these — recomputed
-- from line_items/discount/tax_rate). Mirrors how status='Pending' and
-- source='wizard' are already forced. Also clamp the anon-supplied
-- discount/tax_rate/deposit_pct to sane non-negative ranges so a scripted
-- submit can't inject a negative discount/tax or a >100% deposit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_wizard_quote(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
  v_shop_owner text;
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
