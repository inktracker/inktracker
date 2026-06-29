// Email-based MFA sign-in code delivery.
//
// Called from LoginModal after a successful password verify when the
// caller has profiles.mfa_email_enabled = true. The function:
//
//   1. Validates the user's JWT (they just signed in with password).
//   2. Calls request_mfa_signin_code via that user's session — the RPC
//      mints a 6-digit code, hashes it, stores the hash with a 10-min
//      expiry, enforces the 60-second rate limit, and returns the
//      plaintext for the email body.
//   3. Emails the code via Resend FROM the verified inktracker.app
//      domain to the user's auth email.
//
// We never echo the email back to the browser — a stolen session
// token can't confirm which inbox is on file.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY    = Deno.env.get("RESEND_API_KEY");
const SEND_FROM         = Deno.env.get("FROM_EMAIL") ?? "quotes@inktracker.app";

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

    const { data: rpcData, error: rpcErr } = await supabase.rpc("request_mfa_signin_code");
    if (rpcErr) {
      console.error("[sendMfaSignInCode] rpc error:", rpcErr.message);
      return Response.json({ status: "error" }, { status: 500, headers: CORS });
    }
    if (!rpcData || rpcData.status === "rate_limited") {
      return Response.json({
        status: "rate_limited",
        retry_after_seconds: rpcData?.retry_after_seconds ?? 60,
      }, { headers: CORS });
    }
    if (rpcData.status !== "ok" || !rpcData.code) {
      return Response.json({ status: rpcData?.status || "error" }, { status: 500, headers: CORS });
    }

    if (!RESEND_API_KEY) {
      // Never log the code — it would land in Supabase logs and be a second-
      // factor bypass for anyone with log access.
      console.log("[sendMfaSignInCode] No RESEND_API_KEY — would have emailed a sign-in code to", user.email);
      return Response.json({ status: "ok" }, { headers: CORS });
    }

    const subject = `Your InkTracker sign-in code: ${rpcData.code}`;
    const html = `
      <div style="font-family:-apple-system,system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px 0;">Your sign-in code</h2>
        <p style="margin:0 0 12px 0;">Use this code to finish signing in to InkTracker:</p>
        <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:16px 0;text-align:center;">
          <div style="font-family:Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#0d9488;">${rpcData.code}</div>
        </div>
        <p style="margin:0 0 8px 0;font-size:13px;color:#555;">This code expires in 10 minutes and can be used once.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="margin:0;font-size:12px;color:#888;">If you didn't try to sign in, you can ignore this email — without your password, the code on its own doesn't let anyone in. (If you're seeing repeated codes you didn't request, change your InkTracker password.)</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Sender display name — without this, Gmail/Outlook fall back
        // to showing the local-part ("quotes") as the sender, which
        // looks like spam for a system email about an account.
        from: `InkTracker <${SEND_FROM}>`,
        to: [user.email],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[sendMfaSignInCode] Resend error:", res.status, text);
      return Response.json({ status: "error" }, { status: 500, headers: CORS });
    }

    return Response.json({ status: "ok" }, { headers: CORS });
  } catch (err) {
    console.error("[sendMfaSignInCode] error:", err);
    return Response.json({ status: "error" }, { status: 500, headers: CORS });
  }
});
