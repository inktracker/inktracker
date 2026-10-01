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

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { asBareEmail } from "../_shared/emailSanitize.js";
import { escapeLikeLiteral } from "../_shared/likeEscape.js";

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
    // Must be a real email SHAPE. Note this alone does NOT close the wildcard
    // hole — EMAIL_RE admits `%` (e.g. "%@gmail.com" passes) — the escape on
    // the query below is the actual fix; this just rejects obvious garbage.
    const email = asBareEmail(ownerEmail);
    if (!email) {
      return json({ error: "ownerEmail is required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Two rate limits:
    //  - per client IP: the key an attacker CANNOT choose. Keying only on the
    //    queried email let every new probe string mint a fresh 120/hr bucket,
    //    making the limit useless against enumeration.
    //  - per queried email (kept): bounds load on any one shop's row.
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const [{ data: ipUnder }, { data: emailUnder }] = await Promise.all([
      admin.rpc("check_request_rate", { p_key: `shopcfg_ip:${ip}`, p_limit_per_hr: 240 }),
      admin.rpc("check_request_rate", { p_key: `shopcfg:${email.toLowerCase()}`, p_limit_per_hr: 120 }),
    ]);
    if (ipUnder === false || emailUnder === false) {
      return json({ error: "Too many requests. Please try again shortly." }, 429);
    }

    // escapeLikeLiteral turns ilike into plain case-insensitive EQUALITY:
    // `%`/`_` in the input match literally, never as wildcards. Without it,
    // this anonymous endpoint was an enumeration oracle — "%@gmail.com" with
    // prefix-walking could pull EVERY shop's pricing_config (2026-09-30).
    const { data, error } = await admin
      .from("shops")
      .select(SAFE_COLUMNS)
      .ilike("owner_email", escapeLikeLiteral(email))
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
