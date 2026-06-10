-- Fix: submit_wizard_quote referenced a column that doesn't exist.
--
-- The original RPC (in 20260531_quotes_anon_lockdown.sql) inserted
-- into `in_hands_date`, but the quotes table never had that column —
-- the rest of the app stores in-hands info in `due_date` (see
-- src/components/quotes/QuoteEditorModal.jsx:258). The wizard's own
-- payload also only sends `due_date` (src/components/wizard/
-- OrderWizard.jsx:655) — `in_hands_date` was pure dead code from
-- day one.
--
-- Effect of the bug: every anonymous wizard submission returned
--   {"code":"42703","message":"column \"in_hands_date\" of relation
--    \"quotes\" does not exist"}
-- The shop-side quote flow was unaffected because it doesn't use the
-- RPC. This means embeddable wizards on every shop's website have
-- been broken since the lockdown migration shipped — customers who
-- filled out the form got a 500.
--
-- Caught during a thorough probe of the customer-facing auth-key
-- fix (2026-05-17). Joe found by running edge-function smoke tests.
--
-- Fix: CREATE OR REPLACE the function with `in_hands_date` removed
-- from both the column list and the VALUES clause. Idempotent —
-- re-running is safe.

CREATE OR REPLACE FUNCTION public.submit_wizard_quote(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  v_shop_owner text;
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

-- Permissions unchanged from 20260531 but re-apply for safety.
REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO anon, authenticated;
