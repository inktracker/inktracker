-- Close the reCAPTCHA bypass on the public wizard (pre-scale audit, 2026-07-02).
--
-- 20260823000000 restored the in-DB bot guards AND granted EXECUTE on
-- submit_wizard_quote to anon/authenticated. But the wizardSubmit edge
-- function is where the reCAPTCHA v3 check lives — a client holding the
-- public anon key could call the RPC directly and skip reCAPTCHA entirely,
-- leaving only the honeypot/dwell guards (trivially scripted) and the
-- 30/shop/hour cap between a bot and quote+email creation.
--
-- The ONLY legitimate caller is the wizardSubmit edge function via the
-- service role (supabase/functions/wizardSubmit/index.ts:74). The frontend
-- never calls the RPC directly (src/lib/wizardSubmit.js goes through the
-- edge function). Revoking anon/authenticated forces every submission
-- through the reCAPTCHA gate; all in-DB guards (honeypot, dwell, rate cap,
-- shop-exists) stay active as defense in depth behind it.

REVOKE EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_wizard_quote(jsonb) TO service_role;
