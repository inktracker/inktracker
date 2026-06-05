-- Wizard submissions now always create a customer record and link
-- it to the resulting quote. If the submitted email matches an
-- existing customer on the same shop, the match is recorded on the
-- quote (possible_existing_customer_id) so the shop can decide
-- whether to link the quote to the existing customer or keep the
-- new one — but nothing is auto-merged. The auto-created customer
-- is always created fresh; existing customer data is never
-- overwritten by the wizard.
--
-- The shop sees the suggestion on the quote detail modal; if they
-- accept, the UI does an additive merge (fill blank fields on the
-- existing record from the auto-created one — never overwrite a
-- populated field) and deletes the auto-created customer if it has
-- no other references. The "merge erased one of them" incident
-- with beloved's is the reason this entire flow exists.

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS possible_existing_customer_id UUID
    REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.submit_wizard_quote(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id            uuid;
  v_shop_owner      text;
  v_honeypot        text;
  v_dwell_ms        bigint;
  v_recent_n        int;
  v_email           text;
  v_existing_id     uuid;
  v_new_customer_id uuid;
BEGIN
  v_shop_owner := payload->>'shop_owner';
  IF v_shop_owner IS NULL OR v_shop_owner = '' THEN
    RAISE EXCEPTION 'shop_owner is required';
  END IF;

  IF octet_length(payload::text) > 204800 THEN
    RAISE EXCEPTION 'payload too large';
  END IF;

  -- ── Anti-bot guards (unchanged) ───────────────────────────────────
  v_honeypot := COALESCE(payload->>'_bot_honeypot', '');
  IF length(trim(v_honeypot)) > 0 THEN
    RAISE EXCEPTION 'request rejected';
  END IF;

  v_dwell_ms := COALESCE((payload->>'_bot_dwell_ms')::bigint, 0);
  IF v_dwell_ms < 3000 THEN
    RAISE EXCEPTION 'request rejected';
  END IF;

  SELECT COUNT(*) INTO v_recent_n
  FROM public.quotes
  WHERE shop_owner = v_shop_owner
    AND source = 'wizard'
    AND created_at > NOW() - INTERVAL '1 hour';
  IF v_recent_n >= 30 THEN
    RAISE EXCEPTION 'rate limit exceeded — try again later';
  END IF;

  -- ── Possible-duplicate lookup ─────────────────────────────────────
  -- Done BEFORE the new customer insert so the row we're about to
  -- create can't accidentally match itself. Case-insensitive, scoped
  -- to the same shop. Empty email skips the lookup so we don't bucket
  -- every email-less wizard submission against the same NULL match.
  v_email := lower(trim(COALESCE(payload->>'customer_email', '')));
  IF v_email <> '' THEN
    SELECT id INTO v_existing_id
    FROM public.customers
    WHERE shop_owner = v_shop_owner
      AND lower(trim(coalesce(email, ''))) = v_email
    LIMIT 1;
  END IF;

  -- ── Always create a fresh customer record ─────────────────────────
  -- This is the lowest-risk path: existing customer data is never
  -- touched, and the duplicate suggestion is surfaced to the shop
  -- separately. If they accept the suggestion via the quote modal,
  -- the UI does an additive merge + deletes the auto-created row.
  INSERT INTO public.customers (shop_owner, name, email, phone, company)
  VALUES (
    v_shop_owner,
    COALESCE(NULLIF(payload->>'customer_name', ''), 'Wizard Customer'),
    NULLIF(payload->>'customer_email', ''),
    NULLIF(payload->>'phone', ''),
    NULLIF(payload->>'company', '')
  )
  RETURNING id INTO v_new_customer_id;

  -- ── Insert the quote ──────────────────────────────────────────────
  INSERT INTO public.quotes (
    shop_owner,
    source,
    status,
    quote_id,
    customer_id,
    possible_existing_customer_id,
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
    'wizard',
    'Pending',
    payload->>'quote_id',
    v_new_customer_id,
    v_existing_id,
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

REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO anon, authenticated;
