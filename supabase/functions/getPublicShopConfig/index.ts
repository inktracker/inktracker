// getPublicShopConfig — return the SAFE, wizard-only subset of a shop's config
// for the anonymous public order wizard (QuoteRequest.jsx).
//
// Why this exists: the public wizard needs a shop's pricing_config + wizard
// styling to render technique dropdowns and compute prices in-browser. It used
// to read the `shops` table directly as an anonymous client, which required an
// `shops_anon_select USING(true)` RLS policy — that policy let anyone with the
// bundled anon key enumerate EVERY shop's row, leaking owner emails, Stripe
// account ids, email templates, presses, and production tasks. (Finding A of
// the 2026-06 adversarial review.)
//
// This function runs with the service role and returns ONLY the fields the
// wizard renders. Callers must already know the shop's owner email (it comes
// from the embed URL the shop itself published), so there is no enumeration:
// you can only fetch config for a shop whose wizard you can already reach.
//
// Auth: public (verify_jwt = false). No secret returned — nothing here is more
// sensitive than what the rendered wizard already exposes (prices are computed
// client-side regardless).
//
// Returns: { shop: {<safe fields>} } on success; { shop: null } if not found;
// { error } on bad input.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// The ONLY columns the public wizard renders. Deliberately excludes
// owner_email, stripe_account_id, stripe_account_status, quote_email_subject,
// quote_email_body, presses, production_tasks, and anything else operational.
const SAFE_COLUMNS = [
  "shop_name",
  "brand_color",
  "pricing_config",
  "wizard_styles",
  "wizard_setups",
  "decoration_types",
  "addons",
  "timezone",
].join(",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { ownerEmail } = await req.json().catch(() => ({}));
    if (!ownerEmail || typeof ownerEmail !== "string") {
      return json({ error: "ownerEmail is required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Rate-limit per queried email so this anonymous endpoint can't be used as
    // an unthrottled existence-oracle / DB-load source by probing many emails.
    const { data: underLimit } = await admin.rpc("check_request_rate", {
      p_key: `shopcfg:${ownerEmail.trim().toLowerCase()}`, p_limit_per_hr: 120,
    });
    if (underLimit === false) {
      return json({ error: "Too many requests. Please try again shortly." }, 429);
    }

    const { data, error } = await admin
      .from("shops")
      .select(SAFE_COLUMNS)
      .ilike("owner_email", ownerEmail.trim())
      .maybeSingle();

    if (error) {
      console.error("[getPublicShopConfig] query error:", error.message);
      return json({ error: "lookup failed" }, 500);
    }

    return json({ shop: data ?? null });
  } catch (e) {
    console.error("[getPublicShopConfig] unexpected:", e);
    return json({ error: "unexpected error" }, 500);
  }
});
