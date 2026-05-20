import { createClient } from "npm:@supabase/supabase-js@2";

const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const APP_URL = Deno.env.get("APP_URL") || Deno.env.get("VITE_APP_URL") || "https://www.inktracker.app";
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmailOAuthCallback`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(`${APP_URL}/Account?gmail_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return Response.redirect(`${APP_URL}/Account?gmail_error=missing_params`);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      console.error("Gmail token exchange failed:", tokenRes.status, txt);
      return Response.redirect(`${APP_URL}/Account?gmail_error=token_failed`);
    }

    const tokens = await tokenRes.json();
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Look up via profile_secrets where gmail_oauth_state now lives.
    const { data: secretRow, error: findErr } = await supabaseAdmin
      .from("profile_secrets")
      .select("profile_id, gmail_refresh_token")
      .eq("gmail_oauth_state", state)
      .maybeSingle();

    if (findErr || !secretRow) {
      return Response.redirect(`${APP_URL}/Account?gmail_error=state_mismatch`);
    }

    // Google only returns refresh_token on the first consent. On re-consent
    // (e.g. user re-authorizes without revoking access first) it may be
    // undefined — preserve the existing one in that case so the connection
    // doesn't silently break the next time the access token expires.
    const tokenFields = {
      gmail_access_token:     tokens.access_token,
      gmail_refresh_token:    tokens.refresh_token ?? secretRow.gmail_refresh_token,
      gmail_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      gmail_oauth_state:      null,
    };

    // Single write — profile_secrets is the canonical location post the
    // 20260520_drop_legacy_profile_secret_columns migration.
    await supabaseAdmin
      .from("profile_secrets")
      .upsert(
        { profile_id: secretRow.profile_id, ...tokenFields, updated_at: new Date().toISOString() },
        { onConflict: "profile_id" },
      );

    return Response.redirect(`${APP_URL}/Account?gmail_connected=1`);
  } catch (err) {
    console.error("gmailOAuthCallback error:", err);
    return Response.redirect(`${APP_URL}/Account?gmail_error=server_error`);
  }
});
