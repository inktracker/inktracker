// QuickBooks OAuth 2.0 callback handler
// QB redirects here after user authorizes: ?code=...&state=...&realmId=...
// Exchanges the code for tokens and stores them in the user's profile.

import { createClient } from "npm:@supabase/supabase-js@2";

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const APP_URL          = Deno.env.get("APP_URL") ?? "https://skmltfbibaqcjddmeqvi.supabase.co";
const REDIRECT_URI     = `${APP_URL}/functions/v1/qbOAuthCallback`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url    = new URL(req.url);
  const code   = url.searchParams.get("code");
  const state  = url.searchParams.get("state");   // random UUID stored in profiles.qb_oauth_state
  const realmId = url.searchParams.get("realmId");
  const error  = url.searchParams.get("error");

  // Determine where to send the user back to
  const appBaseUrl = Deno.env.get("VITE_APP_URL") ?? "http://localhost:5173";

  if (error) {
    console.error("QB OAuth error:", error, url.searchParams.get("error_description"));
    return Response.redirect(`${appBaseUrl}/Account?qb_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !realmId) {
    return Response.redirect(`${appBaseUrl}/Account?qb_error=missing_params`);
  }

  try {
    // Exchange auth code for tokens
    const tokenRes = await fetch(QB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      console.error("QB token exchange failed:", tokenRes.status, txt);
      return Response.redirect(`${appBaseUrl}/Account?qb_error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Use service role to find profile by qb_oauth_state and store tokens
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile, error: findErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("qb_oauth_state", state)
      .single();

    if (findErr || !profile) {
      console.error("Could not find profile for state:", state, findErr);
      return Response.redirect(`${appBaseUrl}/Account?qb_error=state_mismatch`);
    }

    const tokenFields = {
      qb_access_token:     tokens.access_token,
      qb_refresh_token:    tokens.refresh_token,
      qb_realm_id:         realmId,
      qb_token_expires_at: expiresAt,
      qb_oauth_state:      null,  // clear the one-time state
    };

    // PRIMARY write — profiles (the legacy path that all readers still use).
    // If this fails the connection is broken regardless of where else we write,
    // so it's the operation that must succeed.
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update(tokenFields)
      .eq("id", profile.id);

    if (updateErr) {
      console.error("Failed to store QB tokens in profiles:", updateErr);
      return Response.redirect(`${appBaseUrl}/Account?qb_error=storage_failed`);
    }

    // SECONDARY write — profile_secrets (new RLS-locked home). Best-effort
    // during migration. A failure here doesn't break the user's connection.
    try {
      await supabaseAdmin
        .from("profile_secrets")
        .upsert({ profile_id: profile.id, ...tokenFields, updated_at: new Date().toISOString() },
                { onConflict: "profile_id" });
    } catch (secretsErr) {
      console.warn("[qbOAuthCallback] dual-write to profile_secrets failed (non-fatal):", secretsErr);
    }

    console.error("QB OAuth success for profile:", profile.id, "realmId:", realmId);
    return Response.redirect(`${appBaseUrl}/Account?qb_connected=1`);
  } catch (err) {
    console.error("qbOAuthCallback exception:", err);
    return Response.redirect(`${appBaseUrl}/Account?qb_error=server_error`);
  }
});
