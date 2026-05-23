-- Founding-member program enforcement.
--
-- Up until now the landing page made claims ("first 100 shops",
-- "cancel forfeits the rate") that the backend couldn't honor —
-- temporarily removed in PR #40 to stop the false advertising.
-- This migration makes the program real.
--
-- Design:
--   - Cap = 50 founding shops (Joe's decision on 2026-05-12 —
--     smaller cohort, more authentic scarcity).
--   - No public counter. The cap is enforced server-side at
--     checkout-create time; users don't see "X of 50 remaining."
--   - Atomic claim via SECURITY DEFINER function + advisory lock —
--     prevents the race where two concurrent signups both see
--     count=49 and both claim slot 50.
--   - Forfeit-on-cancel: when a founding subscription is canceled,
--     founding_rate_forfeited is set so re-signups go to standard.
--
-- Three new columns on profiles:
--   is_founding_member       — true while this shop holds a founding slot
--   founding_rate_forfeited  — true after canceling a founding sub
--   founding_claimed_at      — timestamp of the claim (audit trail)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_founding_member      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_rate_forfeited boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS founding_claimed_at     timestamptz;

-- ── claim_founding_slot ─────────────────────────────────────────
--
-- Called at Stripe checkout-create time. Returns a jsonb status the
-- caller maps to a price ID:
--
--   claimed         — new claim, use $99 price
--   already_member  — re-claim by the same profile, use $99 (idempotent)
--   cap_reached     — 50 slots already taken, use $149 price
--   forfeited       — previously canceled a founding sub, use $149
--   no_profile      — bad profile id (caller bug)
--   bad_input       — null/missing profile id (caller bug)
--
-- The function uses pg_advisory_xact_lock to serialize all claim
-- attempts through a single mutex — under READ COMMITTED isolation,
-- two concurrent transactions could both see count=49 and both
-- claim slot 50 without this lock. The lock has minimal cost (one
-- hash + lock acquire per call) but eliminates the race entirely.

CREATE OR REPLACE FUNCTION public.claim_founding_slot(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_count   int;
  v_cap     int := 50;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_input', 'cap', v_cap);
  END IF;

  -- Serialize all concurrent claims through this advisory lock.
  -- Released automatically at transaction end (xact_lock variant).
  PERFORM pg_advisory_xact_lock(hashtext('inktracker:founding_member_claim'));

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_profile', 'cap', v_cap);
  END IF;

  -- Already founding — idempotent re-call, returns the same answer
  -- as a fresh claim would. Don't bump claimed_at.
  IF v_profile.is_founding_member THEN
    RETURN jsonb_build_object(
      'status',         'already_member',
      'cap',            v_cap,
      'claimed_at',     v_profile.founding_claimed_at
    );
  END IF;

  -- Previously canceled a founding subscription — refuse. Re-signup
  -- routes to the standard price.
  IF v_profile.founding_rate_forfeited THEN
    RETURN jsonb_build_object('status', 'forfeited', 'cap', v_cap);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.profiles
  WHERE is_founding_member = true;

  IF v_count >= v_cap THEN
    RETURN jsonb_build_object('status', 'cap_reached', 'cap', v_cap);
  END IF;

  UPDATE public.profiles
  SET is_founding_member  = true,
      founding_claimed_at = NOW()
  WHERE id = p_profile_id;

  RETURN jsonb_build_object('status', 'claimed', 'cap', v_cap);
END;
$$;

-- Lock down: authenticated callers can invoke it (the billing edge
-- function does so via service-role — both work). Anon cannot,
-- because that would let unauth users burn slots.
REVOKE ALL ON FUNCTION public.claim_founding_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_founding_slot(uuid) TO authenticated, service_role;
