// Public order-wizard submission — server-enforced reCAPTCHA gate.
//
// The wizard is the highest-volume ANONYMOUS write surface (it creates a
// customer + a quote and triggers two outbound emails per submit). It used to
// call the `submit_wizard_quote` RPC directly from the browser with the bundled
// anon key, gated only by a client-asserted honeypot + dwell timer + a per-shop
// 30/hr cap — all of which a scripted attacker bypasses. reCAPTCHA can only be
// a real gate if it's verified server-side in the SAME call that performs the
// insert, which is what this function does:
//   1. verify the reCAPTCHA v3 token with Google (score >= 0.5), then
//   2. call submit_wizard_quote via the service role (the RPC keeps ALL its
//      existing guards: forces status/source, strips broker/token fields,
//      honeypot + dwell + per-shop rate limit + 200 KB payload cap).
//
// verify_jwt = false (anon-callable). Fails CLOSED on a missing/low-score token
// or unconfigured secret; fails OPEN only if Google's siteverify endpoint is
// unreachable, so a Google outage can't take the funnel down.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET_KEY") ?? "";
const RECAPTCHA_MIN_SCORE = 0.5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { payload, recaptchaToken } = await req.json();

    if (!payload || typeof payload !== "object") {
      return json({ error: "Missing payload" }, 400);
    }

    // ── reCAPTCHA gate ────────────────────────────────────────────────
    if (!RECAPTCHA_SECRET) {
      // Misconfiguration — refuse rather than silently accept unverified bots.
      console.error("[wizardSubmit] RECAPTCHA_SECRET_KEY not set — refusing");
      return json({ error: "Submission temporarily unavailable. Please try again later." }, 503);
    }
    if (!recaptchaToken || typeof recaptchaToken !== "string") {
      return json({ error: "Verification required. Please reload the form and try again." }, 400);
    }
    try {
      const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: recaptchaToken }),
      });
      const verdict = await res.json();
      if (!verdict.success || (typeof verdict.score === "number" && verdict.score < RECAPTCHA_MIN_SCORE)) {
        console.error("[wizardSubmit] reCAPTCHA rejected:", { success: verdict.success, score: verdict.score });
        return json({ error: "Could not verify the submission. Please try again." }, 403);
      }
    } catch (verifyErr) {
      // Google unreachable — fail OPEN so a captcha outage doesn't drop real
      // leads. The RPC's honeypot/dwell/rate-limit still apply downstream.
      console.error("[wizardSubmit] siteverify unreachable, failing open:", verifyErr);
    }

    // ── Insert via the locked-down RPC (service role) ─────────────────
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await admin.rpc("submit_wizard_quote", { payload });
    if (error) {
      console.error("[wizardSubmit] submit_wizard_quote failed:", error.message);
      // Surface the RPC's own user-facing messages (rate limit / bot / size).
      return json({ error: error.message || "Submission failed." }, 400);
    }

    return json({ id: data });
  } catch (err) {
    await captureError(err, { fn: "wizardSubmit" });
    console.error("[wizardSubmit] error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
