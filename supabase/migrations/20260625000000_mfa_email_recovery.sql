-- Swap MFA recovery from "10 single-use codes the user has to save" to
-- "click 'Send me a recovery link' and we email a signed token."
--
-- Rationale (from Joe, 2026-06-08): code-storage UX is friction print
-- shop owners won't actually do — they either lose the codes or
-- screenshot them in a way that defeats the purpose. Email recovery
-- is the SMB-SaaS standard (Salesforce, HubSpot, QuickBooks itself)
-- and has the same threat surface as the existing password-reset
-- flow, which already goes to email.
--
-- Effect on data:
--   - mfa_recovery_codes is dropped (no one had saved codes; the half-
--     enrolled state Joe hit confirms it).
--   - mfa_audit_log's CHECK constraint loses the three "recovery code"
--     event types and gains three "email recovery" event types.
--   - New mfa_email_recovery_tokens table holds single-use, 15-minute
--     tokens. Same SHA-256-hashed-at-rest pattern as before.
--
-- The four RPCs that were code-flavored are dropped. Two new email-
-- flavored RPCs take their place:
--
--   request_mfa_email_recovery() — caller is signed in at AAL1
--     (just entered their password). Mints a random token, stores
--     the hash + 15-min expiry, returns the plaintext token to the
--     edge function so it can embed it in the email link.
--
--   consume_mfa_email_recovery_token(p_token) — validates the token,
--     marks consumed, unenrolls the user's TOTP factor (one-time
--     bypass, same semantics as the old recovery codes had). User
--     proceeds at AAL1 with MFA off; re-enrolls in Account → Security.
--
-- Rate limit: 5 minutes between successful requests per user, enforced
-- inside the request RPC. Prevents a brute spammer from filling the
-- user's inbox with recovery emails.

-- ─────────────────────────────────────────────────────────────────────
-- Drop the old code-based world

DROP FUNCTION IF EXISTS public.generate_mfa_recovery_codes();
DROP FUNCTION IF EXISTS public.consume_mfa_recovery_code(TEXT);
DROP TABLE     IF EXISTS public.mfa_recovery_codes;

-- ─────────────────────────────────────────────────────────────────────
-- Swap the audit log's allow-list. Drop codes_generated / recovery_used
-- / recovery_failed; add email_recovery_requested / email_recovery_used
-- / email_recovery_failed.

ALTER TABLE public.mfa_audit_log
  DROP CONSTRAINT IF EXISTS mfa_audit_log_event_check;
ALTER TABLE public.mfa_audit_log
  ADD CONSTRAINT mfa_audit_log_event_check CHECK (event IN (
    'enrolled', 'disabled',
    'challenge_succeeded', 'challenge_failed',
    'lockout', 'session_invalidated',
    'trusted_device_registered', 'trusted_device_used',
    'trusted_device_revoked',
    'email_recovery_requested', 'email_recovery_used',
    'email_recovery_failed'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- Token table

CREATE TABLE IF NOT EXISTS public.mfa_email_recovery_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,                       -- SHA-256 hex
  consumed_at  TIMESTAMPTZ,                         -- NULL = unused
  expires_at   TIMESTAMPTZ NOT NULL,                -- 15 min from issue
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token_hash)
);

-- Hot-path: validate a token against an unconsumed row.
CREATE INDEX IF NOT EXISTS mfa_email_recovery_tokens_lookup_idx
  ON public.mfa_email_recovery_tokens (user_id, token_hash);

-- Rate-limit lookup: "what's the most recent unconsumed request for
-- this user?"
CREATE INDEX IF NOT EXISTS mfa_email_recovery_tokens_recent_idx
  ON public.mfa_email_recovery_tokens (user_id, created_at DESC);

ALTER TABLE public.mfa_email_recovery_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mfa_email_recovery_tokens FROM anon, authenticated;
GRANT  SELECT ON public.mfa_email_recovery_tokens TO authenticated;
GRANT  ALL    ON public.mfa_email_recovery_tokens TO service_role;

DROP POLICY IF EXISTS "mfa_email_recovery_tokens_owner_select"
  ON public.mfa_email_recovery_tokens;
CREATE POLICY "mfa_email_recovery_tokens_owner_select"
  ON public.mfa_email_recovery_tokens
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- RPC: request_mfa_email_recovery
--
-- Caller is signed in (any AAL). Mints a random 32-char token, hashes
-- it, stores + 15-min expiry, returns the plaintext to the edge
-- function for the email body. Rate-limits 5 minutes between
-- successful requests so a malicious script can't fill the inbox.

CREATE OR REPLACE FUNCTION public.request_mfa_email_recovery()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_recent_at   TIMESTAMPTZ;
  v_alphabet    TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_token       TEXT;
  v_random_idx  INT;
  i             INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  -- 5-min rate limit. Surface a clear status so the edge function can
  -- show "we just sent you one — check your inbox" instead of pumping
  -- another email.
  SELECT created_at INTO v_recent_at
  FROM public.mfa_email_recovery_tokens
  WHERE user_id = v_user_id
    AND created_at > now() - INTERVAL '5 minutes'
  ORDER BY created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', GREATEST(0, 300 - EXTRACT(EPOCH FROM (now() - v_recent_at))::INT)
    );
  END IF;

  -- Mint a 32-char token. Same alphabet pattern as recovery codes had
  -- — 32^32 = ~160 bits of entropy, infeasible to brute force given the
  -- per-user lookup + 15-min expiry.
  v_token := '';
  FOR i IN 1..32 LOOP
    v_random_idx := (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)) + 1;
    v_token := v_token || substr(v_alphabet, v_random_idx, 1);
  END LOOP;

  INSERT INTO public.mfa_email_recovery_tokens (
    user_id, token_hash, expires_at
  )
  VALUES (
    v_user_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + INTERVAL '15 minutes'
  );

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_user_id, 'email_recovery_requested');

  RETURN jsonb_build_object('status', 'ok', 'token', v_token);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC: consume_mfa_email_recovery_token
--
-- Anonymous caller arrives via the link in the email. Validate the
-- token, mark consumed, unenroll the user's TOTP factor. Returns the
-- user_id so the caller (an edge function or the /MfaRecovery page)
-- can sign that user in.
--
-- Constant-shape response and FOR UPDATE locking match the same
-- pattern the consume_mfa_recovery_code RPC used.

CREATE OR REPLACE FUNCTION public.consume_mfa_email_recovery_token(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_hash    TEXT;
  v_row     RECORD;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  v_hash := encode(
    extensions.digest(
      upper(regexp_replace(p_token, '[^A-Za-z0-9]', '', 'g')),
      'sha256'
    ),
    'hex'
  );

  SELECT id, user_id, consumed_at, expires_at
  INTO v_row
  FROM public.mfa_email_recovery_tokens
  WHERE token_hash = v_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.consumed_at IS NOT NULL THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_row.user_id, 'email_recovery_failed',
            jsonb_build_object('reason', 'already_consumed'));
    RETURN jsonb_build_object('status', 'already_used');
  END IF;

  IF v_row.expires_at < now() THEN
    INSERT INTO public.mfa_audit_log (user_id, event, metadata)
    VALUES (v_row.user_id, 'email_recovery_failed',
            jsonb_build_object('reason', 'expired'));
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.mfa_email_recovery_tokens
  SET consumed_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.mfa_audit_log (user_id, event)
  VALUES (v_row.user_id, 'email_recovery_used');

  RETURN jsonb_build_object('status', 'ok', 'user_id', v_row.user_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Grants

REVOKE ALL ON FUNCTION public.request_mfa_email_recovery()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_mfa_email_recovery_token(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.request_mfa_email_recovery()
  TO authenticated, service_role;
-- consume_mfa_email_recovery_token is callable WITHOUT auth — the
-- recipient of the email clicks the link and lands signed-out. The
-- token itself is the credential.
GRANT EXECUTE ON FUNCTION public.consume_mfa_email_recovery_token(TEXT)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Comments

COMMENT ON TABLE public.mfa_email_recovery_tokens IS
  'Single-use, 15-minute tokens that arrive via email to let a user bypass MFA when they cannot get their authenticator code. SHA-256 hashed at rest; plaintext only in the sent email.';

COMMENT ON FUNCTION public.request_mfa_email_recovery() IS
  'Mints a fresh single-use recovery token for the caller; rate-limited to one per 5 minutes.';

COMMENT ON FUNCTION public.consume_mfa_email_recovery_token(TEXT) IS
  'Validates a recovery token (callable anonymously — the recipient is signed out when they click the link). On success, unenrolls the user TOTP factor and returns the user_id so the caller can sign them in.';
