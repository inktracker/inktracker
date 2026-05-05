import { createClient } from "npm:@supabase/supabase-js@2";
import { updateProfileSecrets } from "../_shared/profileSecrets.ts";

const SHOPIFY_CLIENT_ID     = Deno.env.get("SHOPIFY_CLIENT_ID")!;
const SHOPIFY_CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET")!;
const APP_URL               = Deno.env.get("APP_URL") || Deno.env.get("VITE_APP_URL") || "https://www.inktracker.app";

Deno.serve(async (req) => {
  const url   = new URL(req.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shop  = url.searchParams.get("shop");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Shopify OAuth error:", error, url.searchParams.get("error_description"));
    return Response.redirect(`${APP_URL}/Inventory?shopify_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !shop) {
    return Response.redirect(`${APP_URL}/Inventory?shopify_error=missing_params`);
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      console.error("Shopify token exchange failed:", tokenRes.status, txt);
      return Response.redirect(`${APP_URL}/Inventory?shopify_error=token_exchange_failed`);
    }

    const { access_token, scope } = await tokenRes.json();
    console.log("Shopify OAuth success, scopes:", scope);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile, error: findErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("shopify_oauth_state", state)
      .single();

    if (findErr || !profile) {
      console.error("Could not find profile for state:", state, findErr);
      return Response.redirect(`${APP_URL}/Inventory?shopify_error=state_mismatch`);
    }

    // Write token to profile_secrets (primary) with dual-write to profiles
    try {
      await updateProfileSecrets(supabaseAdmin, profile.id, {
        shopify_access_token: access_token,
      });
      // shopify_store and oauth_state are non-secret, keep on profiles
      await supabaseAdmin.from("profiles").update({
        shopify_store: shop,
        shopify_oauth_state: null,
      }).eq("id", profile.id);
    } catch (updateErr) {
      console.error("Failed to store Shopify token:", updateErr);
      return Response.redirect(`${APP_URL}/Inventory?shopify_error=storage_failed`);
    }

    return Response.redirect(`${APP_URL}/Inventory?shopify_connected=1`);
  } catch (err) {
    console.error("shopifyOAuthCallback exception:", err);
    return Response.redirect(`${APP_URL}/Inventory?shopify_error=server_error`);
  }
});
