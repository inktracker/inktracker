// MFA email-recovery edge function.
//
// Called from the sign-in MFA challenge screen when the user clicks
// "Send me a recovery link." The user is signed in at AAL1 (just
// entered their password), so the JWT in the Authorization header
// identifies them. We:
//
//   1. Validate the JWT.
//   2. Call request_mfa_email_recovery via that user's session — the
//      RPC mints a fresh single-use 32-char token, stores the hash,
//      enforces the 5-minute rate limit, and returns the plaintext.
//   3. Build the recovery URL (frontend route /MfaRecovery?token=...).
//   4. Send via Resend FROM the verified inktracker.app domain to the
//      user's auth email.
//
// We never echo the email address back; the frontend doesn't need to
// know it, and not revealing the recipient prevents an attacker who
// has someone else's session token from confirming which email is on
// file.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY");
const SEND_FROM         = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";
const APP_ORIGIN        = Deno.env.get("APP_ORIGIN") ?? "https://inktracker.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return Response.json({ status: "unauthenticated" }, { status: 401, headers: CORS });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user?.email) {
      return Response.json({ status: "unauthenticated" }, { status: 401, headers: CORS });
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc("request_mfa_email_recovery");
    if (rpcErr) {
      console.error("[sendMfaRecoveryEmail] rpc error:", rpcErr.message);
      return Response.json({ status: "error" }, { status: 500, headers: CORS });
    }
    if (!rpcData || rpcData.status === "rate_limited") {
      return Response.json({
        status: "rate_limited",
        retry_after_seconds: rpcData?.retry_after_seconds ?? 300,
      }, { headers: CORS });
    }
    if (rpcData.status !== "ok" || !rpcData.token) {
      return Response.json({ status: rpcData?.status || "error" }, { status: 500, headers: CORS });
    }

    const recoveryUrl = `${APP_ORIGIN}/MfaRecovery?token=${encodeURIComponent(rpcData.token)}`;

    if (!RESEND_API_KEY) {
      // Never log the recovery URL — it contains a token that disables MFA and
      // signs the user in. Logging it would be a 2FA bypass for anyone with log access.
      console.log("[sendMfaRecoveryEmail] No RESEND_API_KEY — would have emailed a recovery link to", user.email);
      return Response.json({ status: "ok" }, { headers: CORS });
    }

    const subject = "Recover access to your InkTracker account";
    const html = `
      <div style="font-family:-apple-system,system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px 0;">Sign back into InkTracker</h2>
        <p style="margin:0 0 12px 0;">Someone — hopefully you — asked to recover two-factor access on your InkTracker account.</p>
        <p style="margin:0 0 16px 0;">Click the button below within the next <strong>15 minutes</strong> to sign in. Two-factor authentication will be turned off on your account so you can set up a new device.</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${recoveryUrl}" style="background:#0d9488;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Recover access</a>
        </p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#555;">If the button doesn't work, paste this URL into your browser:</p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#555;word-break:break-all;"><a href="${recoveryUrl}" style="color:#0d9488;">${recoveryUrl}</a></p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="margin:0;font-size:12px;color:#888;">If you didn't request this, you can ignore the email — the link will expire on its own and your account stays protected. (Someone who has your password could trigger this, but they still need access to this email to use the link.)</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `InkTracker <${SEND_FROM}>`,
        to: [user.email],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[sendMfaRecoveryEmail] Resend error:", res.status, text);
      return Response.json({ status: "error" }, { status: 500, headers: CORS });
    }

    return Response.json({ status: "ok" }, { headers: CORS });
  } catch (err) {
    console.error("[sendMfaRecoveryEmail] error:", err);
    return Response.json({ status: "error" }, { status: 500, headers: CORS });
  }
});
