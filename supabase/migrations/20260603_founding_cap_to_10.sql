-- Tighten the founding-member cap from 50 → 10.
--
-- Decision 2026-05-16: smaller, more curated cohort. Joe wants
-- 10 founding shops he can personally support through onboarding,
-- not 50.
--
-- Behavior of this change:
--   - Existing founding members (is_founding_member = true) are
--     GRANDFATHERED. Their slot stays claimed; no data flips.
--   - New signups will hit cap_reached as soon as the count of
--     existing founding members >= 10. The billing edge function
--     then routes them to the $99 standard price.
--   - The forfeit-on-cancel rule still applies — canceling a
--     founding sub still flips founding_rate_forfeited so re-signup
--     pays standard.
--
-- Implementation: CREATE OR REPLACE swaps the function body without
-- dropping it (no permission churn, no race during deploy). The
-- only line that changes is `v_cap int := 50` → `v_cap int := 10`;
-- the surrounding logic is unchanged from 20260520.
--
-- If is_founding_member count is already >= 10 at deploy time, the
-- effect is "no new founding signups possible" — which is fine, the
-- cohort is full.

CREATE OR REPLACE FUNCTION public.claim_founding_slot(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_count   int;
  v_cap     int := 10;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_input', 'cap', v_cap);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('inktracker:founding_member_claim'));

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_profile', 'cap', v_cap);
  END IF;

  IF v_profile.is_founding_member THEN
    RETURN jsonb_build_object(
      'status',         'already_member',
      'cap',            v_cap,
      'claimed_at',     v_profile.founding_claimed_at
    );
  END IF;

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

REVOKE ALL ON FUNCTION public.claim_founding_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_founding_slot(uuid) TO authenticated, service_role;
