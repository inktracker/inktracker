-- Replace the TOTP-flavored MFA stack with email-based 6-digit sign-in
-- codes.
--
-- Why: print shop owners aren't going to install an authenticator
-- app, so TOTP MFA only protects users who happened to already have
-- Google Authenticator on their phone. Email-based codes work for
-- anyone with email. The threat surface is the same as the password-
-- reset flow that already goes to email — phishing the password
-- alone no longer lets an attacker in; they'd need the email account
-- too.
--
-- What this migration changes:
--
--   - DROPS mfa_email_recovery_tokens + its two RPCs (separate
--     recovery flow no longer needed — password reset already goes
--     to email; if the user is locked out, reset password gives them
--     the path back).
--   - REPLACES mfa_audit_log's CHECK constraint allow-list with the
--     event set we'll actually emit going forward. TOTP-era events
--     (enrolled / disabled / challenge_succeeded / challenge_failed /
--     email_recovery_*) become mfa_enabled / mfa_disabled /
--     signin_code_requested / signin_code_verified /
--     signin_code_failed / signin_code_expired. Lockout +
--     trusted_device_* events stay as-is.
--   - ADDS profiles.mfa_email_enabled BOOLEAN. This is the single
--     source of truth for "does this user need a sign-in code." No
--     more reading supabase.auth.mfa_factors.
--   - ADDS mfa_signin_codes table — hashed 6-digit codes, 10-min
--     expiry, single-use.
--   - ADDS four RPCs:
--       enable_mfa_email()              flip the flag on the caller
--       disable_mfa_email()             flip the flag off + invalidate
--                                       outstanding codes
--       request_mfa_signin_code()       generate + store + return
--                                       plaintext to the edge function
--                                       (rate-limited: 60s between calls)
--       verify_mfa_signin_code(p_code)  validate + consume; returns
--                                       ok/expired/invalid
--
-- Notes:
--   - Old TOTP factors on auth.mfa_factors are NOT touched by this
--     migration. Supabase Auth's own MFA system is just unused going
--     forward; existing factors are dormant.
--   - Hashes are SHA-256 with extensions schema qualification — same
--     pattern the trusted_devices RPCs use.

-- ─────────────────────────────────────────────────────────────────────
-- Drop the email-recovery token world

DROP FUNCTION IF EXISTS public.request_mfa_email_recovery();
DROP FUNCTION IF EXISTS public.consume_mfa_email_recovery_token(TEXT);
DROP TABLE     IF EXISTS public.mfa_email_recovery_tokens;

-- ─────────────────────────────────────────────────────────────────────
-- Refresh the audit log allow-list

ALTER TABLE public.mfa_audit_log
  DROP CONSTRAINT IF EXISTS mfa_audit_log_event_check;
-- Wipe rows from defunct TOTP / recovery-codes / email-recovery flows
-- before we narrow the CHECK constraint. The events were already
-- semantically meaningless under the new design.
DELETE FROM public.mfa_audit_log
WHERE event NOT IN (
  'mfa_enabled', 'mfa_disabled',
  'signin_code_requested', 'signin_code_verified',
  'signin_code_failed',    'signin_code_expired',
  'lockout', 'session_invalidated',
  'trusted_device_registered', 'trusted_device_used',
  'trusted_device_revoked'
);
ALTER TABLE public.mfa_audit_log
  ADD CONSTRAINT mfa_audit_log_event_check CHECK (event IN (
    'mfa_enabled', 'mfa_disabled',
    'signin_code_requested', 'signin_code_verified',
    'signin_code_failed',    'signin_code_expired',
    'lockout', 'session_invalidated',
    'trusted_device_registered', 'trusted_device_used',
    'trusted_device_revoked'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- profiles.mfa_email_enabled — single source of truth

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_email_enabled BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────
-- mfa_signin_codes table

CREATE TABLE IF NOT EXISTS public.mfa_signin_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,                       -- SHA-256 hex of the 6-digit code
  consumed_at  TIMESTAMPTZ,                         -- NULL = unused
  expires_at   TIMESTAMPTZ NOT NULL,                -- 10 min from issue
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: look up a single user's most-recent unconsumed code.
CREATE INDEX IF NOT EXISTS mfa_signin_codes_lookup_idx
  ON public.mfa_signin_codes (user_id, code_hash);
-- Rate-limit lookup: "what's the most recent request for this user?"
CREATE INDEX IF NOT EXISTS mfa_signin_codes_recent_idx
  ON public.mfa_signin_codes (user_id, created_at DESC);

ALTER TABLE public.mfa_signin_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mfa_signin_codes FROM anon, authenticated;
GRANT  SELECT ON public.mfa_signin_codes TO authenticated;
GRANT  ALL    ON public.mfa_signin_codes TO service_role;

DROP POLICY IF EXISTS "mfa_signin_codes_owner_select" ON public.mfa_signin_codes;
CREATE POLICY "mfa_signin_codes_owner_select" ON public.mfa_signin_codes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- RPC: enable_mfa_email
-- Caller has already verified a test code via the wrapper UI (the
-- enable button kicks off a verify flow). This just flips the flag.

CREATE OR REPLACE FUNCTION public.enable_mfa_email()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  UPDATE public.profiles
  SET mfa_email_enabled = true
  WHERE auth_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_profile');
  END IF;

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'mfa_enabled');

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: disable_mfa_email
-- Flip flag off and consume every outstanding code so they can't be
-- replayed after the user turns MFA back on later.

CREATE OR REPLACE FUNCTION public.disable_mfa_email()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  UPDATE public.profiles
  SET mfa_email_enabled = false
  WHERE auth_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_profile');
  END IF;

  UPDATE public.mfa_signin_codes
  SET consumed_at = now()
  WHERE user_id = v_user_id AND consumed_at IS NULL;

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'mfa_disabled');

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: request_mfa_signin_code
-- Mints a 6-digit code, hashes it, stores with 10-min expiry, returns
-- the plaintext to the edge function for the email body.
--
-- Invalidates any outstanding unconsumed codes from the same user
-- before issuing — only one active code per user at a time so a
-- delayed first code can't be replayed once the user requests a
-- second one.
--
-- Rate limit: 60 seconds between successful requests per user. The
-- UI surfaces this as "wait 30s before requesting another code."

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

-- ─────────────────────────────────────────────────────────────────────
-- RPC: verify_mfa_signin_code
-- Validates a 6-digit code against the caller's stored hash. Marks
-- consumed on success, returns expired / invalid on failure. Audit
-- entry on every outcome.

CREATE OR REPLACE FUNCTION public.verify_mfa_signin_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hash    TEXT;
  v_row     RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  IF p_code IS NULL OR length(p_code) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  v_hash := encode(
    extensions.digest(
      regexp_replace(p_code, '[^0-9]', '', 'g'),
      'sha256'
    ),
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

-- ─────────────────────────────────────────────────────────────────────
-- Grants

REVOKE ALL ON FUNCTION public.enable_mfa_email()             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_mfa_email()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_mfa_signin_code()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_mfa_signin_code(TEXT)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enable_mfa_email()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disable_mfa_email()          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_mfa_signin_code()    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_mfa_signin_code(TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Comments

COMMENT ON TABLE public.mfa_signin_codes IS
  'Single-use, 10-minute, SHA-256-hashed 6-digit codes emailed at sign-in when the user has profiles.mfa_email_enabled=true.';

COMMENT ON COLUMN public.profiles.mfa_email_enabled IS
  'True when this user requires a 6-digit email code at password sign-in. Trusted-device tokens still skip the code.';

COMMENT ON FUNCTION public.enable_mfa_email() IS
  'Sets mfa_email_enabled=true for the caller. Assumes the caller has just verified a test code via the wrapper UI.';

COMMENT ON FUNCTION public.disable_mfa_email() IS
  'Sets mfa_email_enabled=false for the caller and consumes any outstanding signin codes so they cannot be replayed later.';

COMMENT ON FUNCTION public.request_mfa_signin_code() IS
  'Mints + stores a fresh single-use code and returns plaintext to the edge function. Rate-limited to 60s per user.';

COMMENT ON FUNCTION public.verify_mfa_signin_code(TEXT) IS
  'Validates a 6-digit code against the caller stored hash, marks consumed on success.';
