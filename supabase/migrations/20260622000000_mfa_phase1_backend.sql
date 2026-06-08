-- MFA backend — Phase 1 of the multi-factor auth rollout.
--
-- Background: Supabase Auth ships native TOTP support via the
-- `auth.mfa_factors` table and the `auth.mfa.enroll() / challenge() /
-- verify()` client API. What it does NOT ship is recovery codes — the
-- single-use codes a user prints out at enrollment so they can recover
-- if they lose their authenticator device. Without recovery codes, a
-- lost phone = a support ticket and an admin override, which we don't
-- want to be on the hook for at 10,000 shops.
--
-- This migration adds the two tables MFA needs that aren't built into
-- Supabase Auth, plus three SECURITY DEFINER RPCs that the future UI
-- (Phases 2-5) will call. Phase 1 ships dormant — no UI references
-- these yet, so dropping this in production is a no-op from the user's
-- perspective. The point is to land the schema + functions first so
-- they're battle-tested before any UI flow depends on them.
--
-- Two tables:
--
--   1. mfa_recovery_codes (user_id, code_hash, consumed_at, created_at)
--      Stores SHA-256 hashes of 10 single-use codes per user. We never
--      store plaintext — the codes are shown ONCE at generation time
--      and the user is expected to save them somewhere safe.
--
--   2. mfa_audit_log (user_id, event, ip_address, user_agent, created_at)
--      Append-only record of every MFA-related event: enrolled,
--      disabled, challenge_succeeded, challenge_failed, recovery_used,
--      lockout. Compliance-standard (SOC2 / ISO 27001 expect this).
--      Self-service operators can query "did this user's MFA fail
--      from a weird IP yesterday?" without raw DB access.
--
-- Three RPCs:
--
--   A. generate_mfa_recovery_codes() — wipes any existing codes for
--      the calling user, generates 10 new ones, returns plaintext
--      ONCE. Caller is responsible for displaying them.
--
--   B. consume_mfa_recovery_code(code) — takes a plaintext code,
--      hashes it, looks for an unconsumed match, marks it consumed.
--      Logs success or failure to mfa_audit_log either way.
--
--   C. log_mfa_event(event, ip_address, user_agent) — lightweight
--      insert helper. Used by Phase 2-4 UI to record events the RPCs
--      themselves don't catch (enrolled, disabled, lockout).
--
-- All three are SECURITY DEFINER so they can write rows the caller's
-- RLS would otherwise refuse, and they all scope writes to
-- auth.uid() internally so a caller can't act on another user's
-- behalf even by passing a different user_id.
--
-- pgcrypto's digest() is used for SHA-256. It's already enabled
-- in this DB (gen_random_uuid uses it).

-- ─────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,                       -- SHA-256 hex of the plaintext code
  consumed_at  TIMESTAMPTZ,                         -- NULL = unused; set on first valid use
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)                       -- collisions would be a generator bug; surface them
);

-- Hot path: "find this user's unconsumed code matching this hash."
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_lookup_idx
  ON public.mfa_recovery_codes (user_id, code_hash)
  WHERE consumed_at IS NULL;

-- Operational: "how many unused codes does this user have left?"
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx
  ON public.mfa_recovery_codes (user_id, consumed_at);

CREATE TABLE IF NOT EXISTS public.mfa_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event        TEXT NOT NULL CHECK (event IN (
    'enrolled', 'disabled', 'codes_generated',
    'challenge_succeeded', 'challenge_failed',
    'recovery_used', 'recovery_failed',
    'lockout', 'session_invalidated'
  )),
  ip_address   TEXT,                                -- client-passed; not authoritative
  user_agent   TEXT,                                -- client-passed; not authoritative
  metadata     JSONB,                               -- per-event details (e.g. failure reason)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: "show this user's MFA history."
CREATE INDEX IF NOT EXISTS mfa_audit_log_user_idx
  ON public.mfa_audit_log (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
-- Users can READ their own rows (so the UI can show "you have 7
-- recovery codes left" and "your last MFA event was X"). All writes
-- go through the SECURITY DEFINER RPCs below, which scope by
-- auth.uid() internally. Direct INSERT/UPDATE/DELETE is denied for
-- authenticated users.

ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_audit_log      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mfa_recovery_codes FROM anon, authenticated;
REVOKE ALL ON public.mfa_audit_log      FROM anon, authenticated;
GRANT  SELECT ON public.mfa_recovery_codes TO authenticated;
GRANT  SELECT ON public.mfa_audit_log      TO authenticated;
GRANT  ALL    ON public.mfa_recovery_codes TO service_role;
GRANT  ALL    ON public.mfa_audit_log      TO service_role;

DROP POLICY IF EXISTS "mfa_recovery_codes_owner_select" ON public.mfa_recovery_codes;
CREATE POLICY "mfa_recovery_codes_owner_select" ON public.mfa_recovery_codes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "mfa_audit_log_owner_select" ON public.mfa_audit_log;
CREATE POLICY "mfa_audit_log_owner_select" ON public.mfa_audit_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- RPC: generate_mfa_recovery_codes
-- ─────────────────────────────────────────────────────────────────────
-- Wipes any existing codes for the caller, generates 10 fresh ones,
-- stores their SHA-256 hashes, returns the plaintext codes ONCE so
-- the UI can display them. Caller is responsible for showing them
-- safely and only once — we never store or log plaintext.
--
-- Code format: 10 codes, each 10 chars in [A-HJ-NP-Z2-9] (32 chars,
-- omitting easily-confused I/L/O/0/1). At 10 chars × ~5 bits/char =
-- ~50 bits of entropy per code, well above what's needed against
-- brute force given the per-user lookup + lockout policy.
--
-- Returns: { codes: [...] }

CREATE OR REPLACE FUNCTION public.generate_mfa_recovery_codes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_alphabet   TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_codes      TEXT[] := ARRAY[]::TEXT[];
  v_code       TEXT;
  v_random_idx INT;
  i            INT;
  j            INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status',  'unauthenticated',
      'message', 'No authenticated user'
    );
  END IF;

  -- Wipe existing codes — regeneration always replaces the full set.
  -- If the user had unused codes, those are now invalid; they must
  -- save the new batch.
  DELETE FROM public.mfa_recovery_codes WHERE user_id = v_user_id;

  -- Generate 10 codes.
  FOR i IN 1..10 LOOP
    v_code := '';
    FOR j IN 1..10 LOOP
      -- pgcrypto's gen_random_bytes is cryptographically secure;
      -- mod into the 32-char alphabet for the next character.
      v_random_idx := (get_byte(gen_random_bytes(1), 0) % length(v_alphabet)) + 1;
      v_code := v_code || substr(v_alphabet, v_random_idx, 1);
    END LOOP;
    v_codes := v_codes || v_code;

    -- Store SHA-256 hex hash of the plaintext.
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash)
    VALUES (
      v_user_id,
      encode(digest(v_code, 'sha256'), 'hex')
    );
  END LOOP;

  -- Audit: codes generated (not the codes themselves, just the event).
  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'codes_generated');

  RETURN jsonb_build_object(
    'status', 'ok',
    'codes',  to_jsonb(v_codes)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: consume_mfa_recovery_code
-- ─────────────────────────────────────────────────────────────────────
-- Takes a plaintext code, hashes it, looks for an unconsumed row
-- belonging to the caller, marks it consumed if found. Logs success
-- OR failure to mfa_audit_log either way (so a brute-force attempt
-- leaves a trail).
--
-- Returns: { status: 'consumed' | 'invalid' }
--
-- Intentionally returns the same response shape and timing whether
-- the code was valid-but-already-consumed, invalid, or never existed
-- — minimizes timing/oracle leaks to a caller probing for valid codes.

CREATE OR REPLACE FUNCTION public.consume_mfa_recovery_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_hash     TEXT;
  v_id       UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status',  'unauthenticated',
      'message', 'No authenticated user'
    );
  END IF;

  IF p_code IS NULL OR length(p_code) = 0 THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'recovery_failed',
            jsonb_build_object('reason', 'empty_code'));
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Normalize: uppercase + strip whitespace. The display format may
  -- include a separator (e.g. "ABCDE-FGHJK"); accept either form.
  v_hash := encode(
    digest(
      upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')),
      'sha256'
    ),
    'hex'
  );

  -- Find unconsumed code. Lock the row (FOR UPDATE) so a parallel
  -- consume attempt can't double-spend the same code.
  SELECT id INTO v_id
  FROM public.mfa_recovery_codes
  WHERE user_id = v_user_id
    AND code_hash = v_hash
    AND consumed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'recovery_failed',
            jsonb_build_object('reason', 'no_match'));
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  UPDATE public.mfa_recovery_codes
  SET consumed_at = now()
  WHERE id = v_id;

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'recovery_used');

  RETURN jsonb_build_object('status', 'consumed');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: log_mfa_event
-- ─────────────────────────────────────────────────────────────────────
-- Lightweight insert helper for events the RPCs above don't already
-- write (enrolled, disabled, challenge_succeeded, challenge_failed,
-- lockout, session_invalidated). Callers in Phase 2-4 UI use this to
-- record what happened at the auth boundary. Always scoped to
-- auth.uid() — caller cannot log on behalf of another user.

CREATE OR REPLACE FUNCTION public.log_mfa_event(
  p_event      TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata   JSONB DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  -- The CHECK constraint on mfa_audit_log.event will reject anything
  -- not in the allow-list. Let it bubble up as a Postgres error so the
  -- caller (almost always a Phase 2+ UI) catches the bug at dev time.
  INSERT INTO public.mfa_audit_log (
    user_id, event, ip_address, user_agent, metadata
  )
  VALUES (
    v_user_id, p_event, p_ip_address, p_user_agent, p_metadata
  );

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Grants — let authenticated users CALL the RPCs; service role too.
-- (SECURITY DEFINER + REVOKE PUBLIC means we still control what
-- happens inside the function body.)

REVOKE ALL ON FUNCTION public.generate_mfa_recovery_codes()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_mfa_recovery_code(TEXT)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_mfa_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.generate_mfa_recovery_codes()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_mfa_recovery_code(TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_mfa_event(TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Comments

COMMENT ON TABLE public.mfa_recovery_codes IS
  'Single-use recovery codes for MFA-enrolled users. SHA-256 hashed at rest; plaintext is shown once at generation. Phase 1 of MFA rollout.';

COMMENT ON TABLE public.mfa_audit_log IS
  'Append-only record of every MFA event per user. Compliance-ready (SOC2 / ISO 27001). Writes via RPCs; reads scoped to owning user.';

COMMENT ON FUNCTION public.generate_mfa_recovery_codes() IS
  'Wipes existing recovery codes for the caller, generates 10 fresh ones, returns plaintext ONCE. Idempotent regenerate.';

COMMENT ON FUNCTION public.consume_mfa_recovery_code(TEXT) IS
  'Validates a plaintext recovery code against stored hashes, marks it consumed if valid. Constant-time response shape minimizes timing leaks.';

COMMENT ON FUNCTION public.log_mfa_event(TEXT, TEXT, TEXT, JSONB) IS
  'Records an MFA event (enrolled, disabled, challenge_succeeded, etc.) scoped to the caller. Used by Phase 2-4 UI surfaces.';
