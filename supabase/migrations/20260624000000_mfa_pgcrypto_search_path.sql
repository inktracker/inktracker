-- Fix: pgcrypto functions live in the `extensions` schema in Supabase,
-- not `public`. The Phase 1 + 3b RPCs had `SET search_path = public,
-- pg_temp` so calls to `gen_random_bytes` / `digest` errored with
-- `function gen_random_bytes(integer) does not exist` the first time
-- a real auth.uid() reached the function body.
--
-- The earlier service-role probes returned `unauthenticated` before
-- reaching the pgcrypto calls, so this didn't surface until a real
-- enrollment attempt on 2026-06-08.
--
-- Two-part fix on every affected function:
--
--   1. SET search_path = public, extensions, pg_temp — primary
--      mechanism; matches Supabase's documented convention.
--   2. Schema-qualify every pgcrypto call (extensions.gen_random_bytes,
--      extensions.digest) — defensive; survives any future search_path
--      tweak (e.g. tests, alternative roles).
--
-- Idempotent: every function definition is wrapped in CREATE OR
-- REPLACE. The functions already exist with the wrong search_path;
-- this migration overwrites them with the correct one. Body logic is
-- otherwise unchanged from the originals — the audit story stays
-- intact (codes_generated / recovery_used / trusted_device_used /
-- trusted_device_registered events still fire in the same places).

-- ── public.generate_mfa_recovery_codes ──────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_mfa_recovery_codes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
    RETURN jsonb_build_object('status', 'unauthenticated', 'message', 'No authenticated user');
  END IF;

  DELETE FROM public.mfa_recovery_codes WHERE user_id = v_user_id;

  FOR i IN 1..10 LOOP
    v_code := '';
    FOR j IN 1..10 LOOP
      v_random_idx := (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)) + 1;
      v_code := v_code || substr(v_alphabet, v_random_idx, 1);
    END LOOP;
    v_codes := v_codes || v_code;
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash)
    VALUES (v_user_id, encode(extensions.digest(v_code, 'sha256'), 'hex'));
  END LOOP;

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'codes_generated');

  RETURN jsonb_build_object('status', 'ok', 'codes', to_jsonb(v_codes));
END;
$$;

-- ── public.consume_mfa_recovery_code ────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_mfa_recovery_code(p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_hash    TEXT;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated', 'message', 'No authenticated user');
  END IF;
  IF p_code IS NULL OR length(p_code) = 0 THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'recovery_failed', jsonb_build_object('reason', 'empty_code'));
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  v_hash := encode(
    extensions.digest(
      upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')),
      'sha256'
    ),
    'hex'
  );

  SELECT id INTO v_id
  FROM public.mfa_recovery_codes
  WHERE user_id = v_user_id
    AND code_hash = v_hash
    AND consumed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_user_id, 'recovery_failed', jsonb_build_object('reason', 'no_match'));
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

-- ── public.register_mfa_trusted_device ──────────────────────────────

CREATE OR REPLACE FUNCTION public.register_mfa_trusted_device(
  p_token        TEXT,
  p_device_label TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
    RETURN jsonb_build_object('status', 'invalid_token');
  END IF;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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

-- ── public.check_mfa_trusted_device ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_mfa_trusted_device(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

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
