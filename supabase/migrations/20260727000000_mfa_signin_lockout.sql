-- MFA sign-in code brute-force lockout (audit SEC-02).
--
-- verify_mfa_signin_code() had NO server-side attempt limit — only the React
-- MfaGate counted failures (MAX_ATTEMPTS=10). An attacker who already has the
-- password can skip the UI and POST verify_mfa_signin_code directly (it's
-- GRANTed to authenticated), brute-forcing the 6-digit second factor.
--
-- Fix: enforce the limit in the RPC. Count recent 'signin_code_failed' audit
-- rows for the caller; once the threshold is hit within the window, refuse
-- EVERY verify (even a correct code), invalidate outstanding codes, and emit
-- the 'lockout' audit event (which previously was never written by this path).
-- The lock auto-clears when the failure window rolls off — no manual unlock.
--
-- Threshold/window match the existing client constants (10 attempts / 15 min)
-- so legitimate UI users see no behavior change; this only adds the backstop
-- for direct-RPC callers. 10 guesses / 15 min against a 1,000,000-space code,
-- with codes consumed on lockout, makes brute force infeasible.

CREATE OR REPLACE FUNCTION public.verify_mfa_signin_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_hash       TEXT;
  v_row        RECORD;
  v_fail_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  IF p_code IS NULL OR length(p_code) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- ── SEC-02: brute-force lockout ──────────────────────────────────────
  SELECT count(*) INTO v_fail_count
  FROM public.mfa_audit_log
  WHERE user_id = v_user_id
    AND event = 'signin_code_failed'
    AND created_at > now() - interval '15 minutes';

  IF v_fail_count >= 10 THEN
    -- Invalidate any live codes so a lucky guess can't land post-lockout.
    UPDATE public.mfa_signin_codes
       SET consumed_at = now()
     WHERE user_id = v_user_id AND consumed_at IS NULL;
    -- Emit 'lockout' once per window (avoid audit-log spam on repeated tries).
    IF NOT EXISTS (
      SELECT 1 FROM public.mfa_audit_log
      WHERE user_id = v_user_id
        AND event = 'lockout'
        AND created_at > now() - interval '15 minutes'
    ) THEN
      INSERT INTO public.mfa_audit_log (user_id, event, metadata)
      VALUES (v_user_id, 'lockout',
              jsonb_build_object('reason', 'signin_code_bruteforce', 'fails', v_fail_count));
    END IF;
    RETURN jsonb_build_object('status', 'locked_out');
  END IF;

  v_hash := encode(
    extensions.digest(regexp_replace(p_code, '[^0-9]', '', 'g'), 'sha256'),
    'hex'
  );

  SELECT id, consumed_at, expires_at
  INTO v_row
  FROM public.mfa_signin_codes
  WHERE user_id = v_user_id AND code_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'signin_code_failed', jsonb_build_object('reason', 'no_match'));
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.consumed_at IS NOT NULL THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'signin_code_failed', jsonb_build_object('reason', 'already_used'));
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.expires_at < now() THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'signin_code_expired', jsonb_build_object('id', v_row.id));
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.mfa_signin_codes SET consumed_at = now() WHERE id = v_row.id;

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'signin_code_verified');

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE ALL    ON FUNCTION public.verify_mfa_signin_code(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.verify_mfa_signin_code(TEXT) TO authenticated, service_role;
