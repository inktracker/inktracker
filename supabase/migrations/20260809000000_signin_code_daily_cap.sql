-- RL-03: add a per-user DAILY cap to the MFA email sign-in code.
--
-- request_mfa_signin_code() enforces a 60-second gap between sends, but that
-- alone permits ~1,440 emails/day to a user — an email-bombing vector against
-- anyone whose password (but not MFA) is known, since the code request runs on
-- the post-password, pre-MFA session. Add a rolling-24h cap of 20 sends.
--
-- The request_mfa_email_recovery() path is NOT addressed here: it was dropped in
-- 20260626 (replaced by this sign-in-code flow) and no longer exists.
--
-- CREATE OR REPLACE — identical body to 20260626 plus the daily-cap block. Rows
-- are retained after consume (consumed_at is set, not deleted), so the count is
-- accurate. Returns the same 'rate_limited' status the edge function already
-- handles.

CREATE OR REPLACE FUNCTION public.request_mfa_signin_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_recent_at  TIMESTAMPTZ;
  v_code       TEXT;
  v_byte_val   INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  -- 60-second rate limit. Surface remaining seconds so the UI can
  -- show a countdown rather than just an opaque "try again later."
  SELECT created_at INTO v_recent_at
  FROM public.mfa_signin_codes
  WHERE user_id = v_user_id
    AND created_at > now() - INTERVAL '60 seconds'
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', GREATEST(0, 60 - EXTRACT(EPOCH FROM (now() - v_recent_at))::INT)
    );
  END IF;

  -- Per-user DAILY cap (RL-03): cap at 20 code emails per rolling 24h so the
  -- 60-second gap can't be walked into an email-bombing run.
  IF (
    SELECT count(*) FROM public.mfa_signin_codes
    WHERE user_id = v_user_id AND created_at > now() - INTERVAL '24 hours'
  ) >= 20 THEN
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', 3600
    );
  END IF;

  -- Invalidate outstanding codes so only the newest is valid.
  UPDATE public.mfa_signin_codes
  SET consumed_at = now()
  WHERE user_id = v_user_id AND consumed_at IS NULL;

  -- Generate a 6-digit numeric code. Two bytes give a 0-65535 value;
  -- mod 1_000_000 gives 0-999999 with slight bias toward smaller
  -- values, but well within the entropy a 6-digit code can carry.
  v_byte_val := (get_byte(extensions.gen_random_bytes(1), 0) * 65536)
              + (get_byte(extensions.gen_random_bytes(1), 0) * 256)
              + get_byte(extensions.gen_random_bytes(1), 0);
  v_code := lpad((v_byte_val % 1000000)::TEXT, 6, '0');

  INSERT INTO public.mfa_signin_codes (
    user_id, code_hash, expires_at
  )
  VALUES (
    v_user_id,
    encode(extensions.digest(v_code, 'sha256'), 'hex'),
    now() + INTERVAL '10 minutes'
  );

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'signin_code_requested');

  RETURN jsonb_build_object('status', 'ok', 'code', v_code);
END;
$$;
