-- Fix: pgcrypto functions live in the `extensions` schema in Supabase,
-- not `public`. The Phase 3b trusted-device RPCs had `SET search_path =
-- public, pg_temp` so calls to `digest` errored with
-- `function digest(text, unknown) does not exist` the first time a
-- real auth.uid() reached the function body.
--
-- The earlier service-role probes returned `unauthenticated` before
-- reaching the pgcrypto calls, so this didn't surface until a real
-- enrollment attempt on 2026-06-08.
--
-- Two-part fix on both affected functions:
--
--   1. SET search_path = public, extensions, pg_temp — primary
--      mechanism; matches Supabase's documented convention.
--   2. Schema-qualify every pgcrypto call (extensions.digest) —
--      defensive; survives any future search_path tweak (e.g. tests,
--      alternative roles).
--
-- History note: this fix was applied to prod out-of-band during the
-- 2026-06-08 incident; this migration brings the repo back in line
-- with the live DB. An earlier draft (20260624000000) also patched
-- generate_mfa_recovery_codes + consume_mfa_recovery_code, but
-- 20260625000000_mfa_email_recovery dropped both functions and the
-- mfa_recovery_codes table when recovery codes were replaced with
-- email recovery — so only the trusted-device functions remain here.
--
-- Idempotent: CREATE OR REPLACE of definitions identical to what prod
-- already runs. Body logic is otherwise unchanged from 20260623 — the
-- audit story stays intact (trusted_device_used /
-- trusted_device_registered events still fire in the same places).

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
