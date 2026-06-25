// QuickBooks OAuth 2.0 callback handler
// QB redirects here after user authorizes: ?code=...&state=...&realmId=...
// Exchanges the code for tokens and stores them in the user's profile.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildOAuthTokenFields } from "../_shared/connectionLogic.js";
import { validateQbTokenResponse } from "../_shared/qbOAuthResponse.js";

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const APP_URL          = Deno.env.get("APP_URL") || Deno.env.get("VITE_APP_URL") || "https://www.inktracker.app";
// Was: `Deno.env.get("SUPABASE_URL") || "https://skmltfbibaqcjddmeqvi.supabase.co"`.
// The hardcoded fallback meant a staging/preview deploy with no
// SUPABASE_URL set would silently upsert QB tokens into the PROD
// project. Fail loudly instead — the env var must be set by the
// Supabase Edge Functions deploy config.
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
if (!SUPABASE_URL) {
  console.error("[qbOAuthCallback] SUPABASE_URL env var is not set. Refusing to start.");
}
// Token-exchange MUST use the same redirect_uri that the initial
// auth request used. Both now go through the Vercel proxy because
// the Supabase gateway rejects Intuit's direct redirect (no auth
// header). See api/qb-callback.js for the proxy.
const REDIRECT_URI     = `${APP_URL.replace(/\/+$/, "")}/api/qb-callback`;

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

  const appBaseUrl = APP_URL;

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
    // Validate the response shape BEFORE we trust it. Mirrors the same
    // guard qbSync.refreshToken applies. Without this, a malformed 200
    // OK from Intuit (occasionally observed under API stress) would
    // persist `undefined` access_token / refresh_token to
    // profile_secrets and lock the shop out of every future QB request
    // — the "QuickBooks not connected" gate would short-circuit
    // everything. Refusing here keeps the existing connection (if any)
    // intact and surfaces a clear error to the operator.
    const check = validateQbTokenResponse(tokens);
    if (!check.ok) {
      // Log only the shape — `tokens` can contain a live token even when malformed.
      console.error(`[qbOAuthCallback] Initial token exchange returned malformed body (${check.reason}); keys:`, tokens && typeof tokens === "object" ? Object.keys(tokens) : typeof tokens);
      return Response.redirect(`${appBaseUrl}/Account?qb_error=malformed_token_response`);
    }
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Use service role to find profile by qb_oauth_state and store tokens
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the profile via profile_secrets (where qb_oauth_state now
    // lives, post-secrets-migration). The companion `qb_oauth_state_at`
    // column lets us enforce a 30-minute expiry — closes the
    // "state stays valid forever" property the column-less design had.
    let profileId: string | null = null;
    let profileRole: string | null = null;
    const { data: secretRow } = await supabaseAdmin
      .from("profile_secrets")
      .select("profile_id, qb_oauth_state_at")
      .eq("qb_oauth_state", state)
      .maybeSingle();

    if (secretRow?.profile_id) {
      // Enforce expiry. Default to "expired" when the timestamp is
      // missing — pre-migration states never get accepted again, which
      // is what we want (force a fresh connect through the new flow).
      const stateAt = secretRow.qb_oauth_state_at
        ? new Date(secretRow.qb_oauth_state_at).getTime()
        : 0;
      const STATE_TTL_MS = 30 * 60 * 1000;
      if (!stateAt || Date.now() - stateAt > STATE_TTL_MS) {
        console.error(`[qbOAuthCallback] State expired (age ${stateAt ? Date.now() - stateAt : "no-timestamp"}ms) — refusing token exchange`);
        return Response.redirect(`${appBaseUrl}/Account?qb_error=state_expired`);
      }
      profileId = secretRow.profile_id;
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", profileId)
        .maybeSingle();
      profileRole = p?.role ?? null;
    }

    if (!profileId) {
      console.error("Could not find profile for state:", state);
      return Response.redirect(`${appBaseUrl}/Account?qb_error=state_mismatch`);
    }

    // Pure builder + tests live in ../_shared/connectionLogic.js + __tests__.
    const tokenFields = buildOAuthTokenFields(tokens, realmId, expiresAt);

    // Single write — profile_secrets is the canonical location for tokens.
    // The legacy `profiles` columns were dropped in the
    // 20260520_drop_legacy_profile_secret_columns migration.
    //
    // Clear the OAuth state (and its issued-at timestamp) in the same
    // upsert so it can't be replayed. The auth code from Intuit is
    // already one-time-use on their side, but the state should
    // independently follow the same property — defense in depth.
    const { error: upsertErr } = await supabaseAdmin
      .from("profile_secrets")
      .upsert(
        {
          profile_id: profileId,
          ...tokenFields,
          qb_oauth_state: null,
          qb_oauth_state_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id" },
      );
    if (upsertErr) {
      console.error("Failed to store QB tokens in profile_secrets:", upsertErr);
      return Response.redirect(`${appBaseUrl}/Account?qb_error=storage_failed`);
    }

    console.error("QB OAuth success for profile:", profileId, "realmId:", realmId);
    const redirectPage = profileRole === "broker" ? "/BrokerDashboard?tab=profile&qb_connected=1" : "/Account?qb_connected=1";
    return Response.redirect(`${appBaseUrl}${redirectPage}`);
  } catch (err) {
    console.error("qbOAuthCallback exception:", err);
    return Response.redirect(`${appBaseUrl}/Account?qb_error=server_error`);
  }
});
