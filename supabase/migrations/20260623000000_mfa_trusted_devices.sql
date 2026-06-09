-- MFA trusted devices — Phase 3b of the MFA rollout.
--
-- Adds the "Remember this device for 30 days" pattern on top of the
-- TOTP challenge that shipped in Phase 3. When a user checks the
-- box at sign-in, the client generates a random opaque token, stores
-- the plaintext in localStorage, and we store the SHA-256 hash here.
-- Next sign-in on the same browser, the client checks the token
-- against this table — if it matches an unexpired row, the MFA
-- challenge is skipped for that session.
--
-- Tokens expire 30 days after registration. The shop can revoke a
-- specific device or all devices from Account → Security (Phase 4
-- UI; the RPCs ship here so the data layer is ready).
--
-- Security model:
--   - Plaintext never lives server-side. We only ever store SHA-256
--     hashes (same pattern as recovery codes).
--   - localStorage on the device holds the only copy of the
--     plaintext. Clearing browser data invalidates the trust (the
--     row is still in the table but the device can no longer match
--     it; it'll expire on its own in 30 days).
--   - Token is generated as `crypto.randomUUID()` on the client.
--     128 bits of entropy, infeasible to brute force.
--   - The audit log records register / use / revoke events with
--     the row's id (not the token) for traceability.

-- ─────────────────────────────────────────────────────────────────────
-- Table

CREATE TABLE IF NOT EXISTS public.mfa_trusted_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,                       -- SHA-256 hex of the plaintext token
  device_label  TEXT,                                -- truncated user-agent for display
  last_used_at  TIMESTAMPTZ,                         -- updated each time the device is checked
  expires_at    TIMESTAMPTZ NOT NULL,                -- 30 days from registration
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token_hash)                       -- collision = generator bug; surface it
);

-- Hot path: "is THIS token valid for THIS user, right now?"
-- Plain composite (no WHERE) because Postgres requires index predicates
-- to use only IMMUTABLE functions and `now()` is STABLE. The
-- check_mfa_trusted_device RPC filters expires_at in the query itself,
-- so the planner still narrows correctly via this index — we just
-- carry expired rows in it until they age out of the table.
CREATE INDEX IF NOT EXISTS mfa_trusted_devices_lookup_idx
  ON public.mfa_trusted_devices (user_id, token_hash);

-- "show me all my trusted devices, newest first" — Account UI.
CREATE INDEX IF NOT EXISTS mfa_trusted_devices_user_idx
  ON public.mfa_trusted_devices (user_id, created_at DESC);

-- Expand the audit log's event allow-list. The CHECK constraint
-- pinned to Phase 1's value list rejects any new event types until
-- we update it.
ALTER TABLE public.mfa_audit_log
  DROP CONSTRAINT IF EXISTS mfa_audit_log_event_check;
ALTER TABLE public.mfa_audit_log
  ADD CONSTRAINT mfa_audit_log_event_check CHECK (event IN (
    'enrolled', 'disabled', 'codes_generated',
    'challenge_succeeded', 'challenge_failed',
    'recovery_used', 'recovery_failed',
    'lockout', 'session_invalidated',
    'trusted_device_registered', 'trusted_device_used',
    'trusted_device_revoked'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- Users SELECT their own rows (for the Account → Security device list).
-- All writes go through the SECURITY DEFINER RPCs below.

ALTER TABLE public.mfa_trusted_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mfa_trusted_devices FROM anon, authenticated;
GRANT SELECT ON public.mfa_trusted_devices TO authenticated;
GRANT ALL    ON public.mfa_trusted_devices TO service_role;

DROP POLICY IF EXISTS "mfa_trusted_devices_owner_select" ON public.mfa_trusted_devices;
CREATE POLICY "mfa_trusted_devices_owner_select" ON public.mfa_trusted_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- RPC: register_mfa_trusted_device
-- Hashes the token, inserts (or refreshes the expiry on) a row for
-- the caller, returns the row id so the client can store it for
-- later revocation if it wants.

CREATE OR REPLACE FUNCTION public.register_mfa_trusted_device(
  p_token        TEXT,
  p_device_label TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hash    TEXT;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  IF p_token IS NULL OR length(p_token) < 16 THEN
    -- Too short to be the 36-char UUID we expect. Refuse rather than
    -- letting a weak token register a 30-day trust.
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  INSERT INTO public.mfa_trusted_devices (
    user_id, token_hash, device_label, expires_at
  )
  VALUES (
    v_user_id, v_hash,
    COALESCE(NULLIF(trim(p_device_label), ''), 'Unknown device'),
    now() + INTERVAL '30 days'
  )
  ON CONFLICT (user_id, token_hash) DO UPDATE
    SET expires_at   = EXCLUDED.expires_at,
        device_label = COALESCE(EXCLUDED.device_label, mfa_trusted_devices.device_label)
  RETURNING id INTO v_id;

  INSERT INTO public.mfa_audit_log (user_id, event, metadata)
  VALUES (v_user_id, 'trusted_device_registered',
          jsonb_build_object('id', v_id, 'label', p_device_label));

  RETURN jsonb_build_object('status', 'ok', 'id', v_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: check_mfa_trusted_device
-- Hashes the token, looks for an unexpired row for the caller. On
-- match: bump last_used_at + audit + return trusted:true. On miss:
-- return trusted:false with a constant-shape response (no timing
-- oracle leaking whether the user has ANY trusted devices).

CREATE OR REPLACE FUNCTION public.check_mfa_trusted_device(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hash    TEXT;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated', 'trusted', false);
  END IF;
  IF p_token IS NULL OR length(p_token) = 0 THEN
    RETURN jsonb_build_object('status', 'no_token', 'trusted', false);
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT id INTO v_id
  FROM public.mfa_trusted_devices
  WHERE user_id = v_user_id
    AND token_hash = v_hash
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_trusted', 'trusted', false);
  END IF;

  UPDATE public.mfa_trusted_devices
  SET last_used_at = now()
  WHERE id = v_id;

  INSERT INTO public.mfa_audit_log (user_id, event, metadata)
  VALUES (v_user_id, 'trusted_device_used', jsonb_build_object('id', v_id));

  RETURN jsonb_build_object('status', 'ok', 'trusted', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: revoke_mfa_trusted_device(id)
-- Single-row delete scoped by user_id. Used by Account → Security
-- (Phase 4) to drop a specific device.

CREATE OR REPLACE FUNCTION public.revoke_mfa_trusted_device(p_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deleted INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  DELETE FROM public.mfa_trusted_devices
  WHERE id = p_id AND user_id = v_user_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'trusted_device_revoked', jsonb_build_object('id', p_id));
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  RETURN jsonb_build_object('status', 'not_found');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: revoke_all_mfa_trusted_devices
-- "Sign out every other browser" button. Returns the count so the UI
-- can give the user a quick confirmation.

CREATE OR REPLACE FUNCTION public.revoke_all_mfa_trusted_devices()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deleted INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  DELETE FROM public.mfa_trusted_devices WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.mfa_audit_log (user_id, event, metadata)
  VALUES (v_user_id, 'trusted_device_revoked',
          jsonb_build_object('all', true, 'count', v_deleted));

  RETURN jsonb_build_object('status', 'ok', 'count', v_deleted);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Grants

REVOKE ALL ON FUNCTION public.register_mfa_trusted_device(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_mfa_trusted_device(TEXT)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_mfa_trusted_device(UUID)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_all_mfa_trusted_devices()        FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.register_mfa_trusted_device(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_mfa_trusted_device(TEXT)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_mfa_trusted_device(UUID)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_all_mfa_trusted_devices()        TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Comments

COMMENT ON TABLE public.mfa_trusted_devices IS
  'Long-lived device tokens that skip the MFA challenge on a known browser for 30 days. SHA-256 hashed at rest; plaintext lives only in localStorage on the device.';

COMMENT ON FUNCTION public.register_mfa_trusted_device(TEXT, TEXT) IS
  'Registers a new trusted device for the caller. Hashes the token, stores 30-day expiry, returns the row id.';

COMMENT ON FUNCTION public.check_mfa_trusted_device(TEXT) IS
  'Checks whether the given token corresponds to an unexpired trusted device for the caller. Bumps last_used_at on match.';
