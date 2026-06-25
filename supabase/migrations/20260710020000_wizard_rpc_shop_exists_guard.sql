-- ============================================================================
-- SECURITY (MEDIUM): submit_wizard_quote must reject submissions for a
-- shop_owner that doesn't exist.
-- ============================================================================
-- The anon wizard RPC took payload->>'shop_owner' and inserted a quote scoped
-- to it, validating only that the value was non-empty — never that the shop
-- exists. Anyone with the bundled anon key (+ a guessed owner email) could
-- inject junk quotes into a tenant, or create orphan quotes under a made-up
-- owner. The sibling `orders_anon_insert` policy already guards this with
-- `EXISTS (SELECT 1 FROM shops WHERE owner_email = ...)`; this mirrors it.
--
-- NOTE ON DRIFT: the live function body is the pre-bot-guards / pre-autolink
-- version (migrations 20260606170000 + 20260621020000 are RECORDED as applied
-- but a later out-of-order CREATE OR REPLACE reverted the body). This migration
-- recreates the CURRENTLY-LIVE body verbatim and only inserts the shop-exists
-- guard, so it does NOT silently change customer-creation behavior. Restoring
-- the bot guards / autolink is tracked separately.
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

  -- Shop must actually exist. Mirrors orders_anon_insert's guard so the
  -- wizard can't inject quotes into a non-existent or unguessed tenant.
  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE owner_email = v_shop_owner) THEN
    RAISE EXCEPTION 'unknown shop';
  END IF;

  -- Defensive size guard. The wizard sends modest payloads (~10 KB
  -- typical); 200 KB is well above realistic submissions and well
  -- below abusive spam.
  IF octet_length(payload::text) > 204800 THEN
    RAISE EXCEPTION 'payload too large';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO anon, authenticated;
