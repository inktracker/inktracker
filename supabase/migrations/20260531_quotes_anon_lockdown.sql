-- ============================================================================
-- Quotes — close the anonymous-SELECT data leak.
-- ============================================================================
-- BEFORE this migration:
--
--   CREATE POLICY "quotes_anon_select" ON quotes FOR SELECT TO anon
--     USING (true);
--
-- That policy let anyone with the (publicly-embedded) Supabase anon key
-- hit `GET /rest/v1/quotes?select=*` and dump every quote in the
-- database — customer names, emails, totals, line items, the lot.
-- Token gating existed only at the application + edge-function layer;
-- the RLS itself was wide open.
--
-- We can't just DROP the SELECT policy: the public wizard's quote
-- submission goes through `base44.entities.Quote.create()` which does
-- `INSERT ... RETURNING ...`. RETURNING re-checks SELECT permission,
-- so dropping the policy breaks `QuoteRequest.jsx:49` submission.
--
-- Fix: replace anon's direct table access with a SECURITY DEFINER
-- RPC that bypasses RLS, takes only a whitelist of wizard fields,
-- and forces status='Pending' + source='wizard' so a malicious
-- client can't elevate their submission or claim broker fields.
--
-- After this migration:
--   - Anon has NO direct SELECT/INSERT on quotes via REST.
--   - Anon's only path to insert a quote is the locked-down RPC.
--   - Authenticated shop owners + brokers keep working through
--     `quotes_owner` / `quotes_broker` (unchanged).
--   - Edge functions (sendQuoteEmail, createCheckoutSession, etc.)
--     keep working — they use service_role which bypasses RLS.
--
-- Frontend follow-up: QuoteRequest.jsx calls submitWizardQuote() from
-- src/lib/wizardSubmit.js which wraps `supabase.rpc('submit_wizard_quote', ...)`.
-- ============================================================================

-- ── 1. Drop the wide-open anon policies ─────────────────────────────────────

DROP POLICY IF EXISTS quotes_anon_select ON public.quotes;
DROP POLICY IF EXISTS quotes_anon_insert ON public.quotes;

-- ── 2. SECURITY DEFINER function for anonymous wizard submission ────────────
--
-- Takes a jsonb payload. Whitelists fields the wizard is allowed to
-- set. Forces server-controlled fields (status, source) regardless of
-- what the caller sent. Returns the inserted row's UUID so the caller
-- can confirm success without needing SELECT permission.
--
-- Protected (forced or stripped) fields:
--   broker_id / broker_email / broker_name  — anon can't claim broker
--   public_token                            — set later when shop sends
--   sent_to / sent_date                     — set by shop on send
--   status                                  — forced to 'Pending'
--   source                                  — forced to 'wizard'
--   customer_id                             — set when shop converts
--   subtotal/tax/total                      — accepted because wizard
--     pre-calculates an estimate. Shop owner reviews + edits later.

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
    in_hands_date,
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
    NULLIF(payload->>'in_hands_date', '')::date,
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

-- Lock executor permissions. Anon callers need EXECUTE so the public
-- wizard works; authenticated users also get it for the embed wizard
-- when a logged-in shop owner is testing their own form. REVOKE the
-- catch-all PUBLIC grant first so other roles don't get accidental
-- access.
REVOKE ALL ON FUNCTION public.submit_wizard_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO anon, authenticated;
