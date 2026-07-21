// Profile secrets — surface for the frontend to read connection FLAGS
// (booleans only, never the actual secrets) and to SAVE supplier credentials
// without going through `base44.auth.updateMe()`.
//
// Why this exists: the `profiles` table had its secret columns (QB tokens,
// Gmail tokens, S&S/AC creds) readable by every assigned teammate via the
// `profiles_select_team` / `profiles_select_shop_owner` RLS policies. To
// close that intra-shop leak we moved the storage to `profile_secrets`
// (service-role-only RLS) and stopped writing the columns on `profiles`.
// The frontend can no longer read its own secrets back via `SELECT * FROM
// profiles` — it has to come through this function.
//
// Actions:
//   getFlags     → returns { qb, gmail, ss, ac } booleans
//   update       → upserts supplier creds via updateProfileSecrets
//   startConnect → generates an OAuth state UUID, stores it bound to the
//                  caller's profile, returns it for use in the auth URL.
//                  Used for QB and Gmail OAuth flows that previously wrote
//                  qb_oauth_state / gmail_oauth_state to profiles directly.
//
// Auth: caller must present a valid Bearer token; we resolve to the
// caller's own profile only (no broker/manager impersonation possible).
// Subscription gate is intentionally NOT enforced — disconnecting
// integrations should always work even on expired trials.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { updateProfileSecrets, loadProfileWithSecrets } from "../_shared/profileSecrets.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Whitelist of fields the frontend is allowed to write through `update`.
// Anything else in the payload is silently dropped. Prevents a malicious
// caller from poking at OAuth tokens directly.
const UPDATABLE_KEYS = new Set([
  "ss_account_number",
  "ss_api_key",
  "ac_email",          // not actually a secret, but logically grouped with ac_* creds
  "ac_password",
  "ac_subscription_key",
  "sanmar_customer_number",
  "sanmar_username",
  "sanmar_password",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken: bodyToken } = body;

    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") || bodyToken;
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${authHeader}` } },
    });
    const { data: { user } } = await userClient.auth.getUser(authHeader);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const profile = await loadProfileWithSecrets(admin, { auth_id: user.id });
    if (!profile) return json({ error: "Profile not found" }, 404);

    if (action === "getFlags") {
      return json({
        qb:    Boolean(profile.qb_access_token),
        gmail: Boolean(profile.gmail_access_token),
        ss:    Boolean(profile.ss_account_number && profile.ss_api_key),
        ac:    Boolean(profile.ac_subscription_key),
        sanmar: Boolean(profile.sanmar_customer_number && profile.sanmar_username && profile.sanmar_password),
        // ac_email isn't a secret, but the frontend wants to display it
        ac_email: profile.ac_email ?? null,
        // Same for the SanMar username — shown as "connected as ..." in Account.
        sanmar_username: profile.sanmar_username ?? null,
        // Presence flag only (never the value) — the credentials form needs
        // it to enforce completeness: AS Colour PRICING requires a Bearer
        // token (email + password), so a key-only connection browses the
        // catalog but silently gets no prices.
        ac_password: Boolean(profile.ac_password),
      });
    }

    if (action === "update") {
      const updates = body.updates ?? {};
      const filtered: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (UPDATABLE_KEYS.has(k)) filtered[k] = v as string | null;
      }
      if (Object.keys(filtered).length === 0) {
        return json({ error: "No allowed fields in update" }, 400);
      }
      await updateProfileSecrets(admin, profile.id, filtered);
      return json({ ok: true });
    }

    if (action === "startConnect") {
      // provider in { "qb", "gmail" }. Generates a fresh state UUID, stores
      // it on profile_secrets, returns it so the frontend can put it in
      // the OAuth authorize URL. The callback later finds the profile by
      // matching this state and (for QB) checks the issuance timestamp
      // to enforce a 30-minute lifetime.
      const provider = body.provider;
      const stateKey =
        provider === "qb"    ? "qb_oauth_state" :
        provider === "gmail" ? "gmail_oauth_state" :
        null;
      if (!stateKey) return json({ error: `Unknown provider: ${provider}` }, 400);
      const state = crypto.randomUUID();
      // qb_oauth_state_at lets qbOAuthCallback reject expired states.
      // gmail follows the same column convention but expiry isn't
      // enforced there yet (separate audit pass).
      const stampedAt = provider === "qb" ? { qb_oauth_state_at: new Date().toISOString() } : {};
      await updateProfileSecrets(admin, profile.id, { [stateKey]: state, ...stampedAt });
      return json({ state });
    }

    if (action === "disconnectProvider") {
      // Clears all tokens for the given provider. Used by the frontend's
      // Disconnect buttons. Subscription-gate-free so paying status edge
      // cases never lock anyone out of their own integration.
      const provider = body.provider;
      let clearFields: Record<string, null> | null = null;
      if (provider === "qb") {
        clearFields = {
          qb_access_token: null,
          qb_refresh_token: null,
          qb_realm_id: null,
          qb_token_expires_at: null,
          qb_oauth_state: null,
        };
      } else if (provider === "gmail") {
        clearFields = {
          gmail_access_token: null,
          gmail_refresh_token: null,
          gmail_token_expires_at: null,
          gmail_oauth_state: null,
        };
      } else if (provider === "ss") {
        clearFields = { ss_account_number: null, ss_api_key: null };
      } else if (provider === "ac") {
        clearFields = { ac_subscription_key: null, ac_email: null, ac_password: null };
      } else if (provider === "sanmar") {
        clearFields = { sanmar_customer_number: null, sanmar_username: null, sanmar_password: null };
      } else {
        return json({ error: `Unknown provider: ${provider}` }, 400);
      }
      await updateProfileSecrets(admin, profile.id, clearFields);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[profileSecrets] error:", err);
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});
