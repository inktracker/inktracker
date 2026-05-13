import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_TEST_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || Deno.env.get("VITE_APP_URL") || "https://www.inktracker.app";

// Two-tier pricing. The founding rate is locked for the first 50
// shops to claim it (enforced atomically by the claim_founding_slot
// RPC in 20260520_founding_member_program.sql). Cap is hidden from
// the public UI — there's no slot counter on the landing page.
//
// STRIPE_PRICE_STANDARD is read from env so Joe can drop in the
// real price ID without redeploying. If it's not set, we fall back
// to the founding price — over-discount during the bootstrap window
// is better than a broken checkout.
const PRICE_FOUNDING = "price_1TR50AI4m9BGT2cwXUsKF6Ul"; // $99/mo, existing
const PRICE_STANDARD = Deno.env.get("STRIPE_PRICE_STANDARD") || PRICE_FOUNDING;

const PRICES: Record<string, string> = {
  shop:     PRICE_FOUNDING, // legacy callers that just say "shop" still work
  founding: PRICE_FOUNDING,
  standard: PRICE_STANDARD,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getProfile(authId: string) {
  return loadProfileWithSecrets(adminClient(), { auth_id: authId });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, accessToken } = body;

    // Authenticate the caller
    const supaUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: { user }, error: authErr } = await supaUser.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const profile = await getProfile(user.id);
    if (!profile) return json({ error: "Profile not found" });

    // ── activateTrial ─────────────────────────────────────────────
    if (action === "activateTrial") {
      if (profile.role !== "user") return json({ already: true });
      const trialEnd = new Date(Date.now() + 14 * 86400000).toISOString();
      const admin = adminClient();
      const { data: updated, error: updateErr } = await admin
        .from("profiles")
        .update({
          role: "shop",
          subscription_tier: "trial",
          subscription_status: "trialing",
          trial_ends_at: trialEnd,
        })
        .eq("auth_id", user.id)
        .select("id, role, subscription_tier")
        .single();
      console.error("[billing] activateTrial:", { updateErr, updated, authId: user.id, profileId: profile.id });
      if (updateErr) {
        return json({ error: updateErr.message }, 500);
      }
      return json({ activated: true, trial_ends_at: trialEnd, role: updated?.role });
    }

    // ── getSubscription ─────────────────────────────────────────────
    if (action === "getSubscription") {
      const now = new Date();
      const trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
      const trialDaysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86400000)) : 0;
      const trialExpired = trialEnd ? now > trialEnd : false;

      return json({
        tier: profile.subscription_tier || "trial",
        status: profile.subscription_status || "trialing",
        trialEndsAt: profile.trial_ends_at,
        trialDaysLeft,
        trialExpired,
        stripeCustomerId: profile.stripe_customer_id,
        stripeSubscriptionId: profile.stripe_subscription_id,
      });
    }

    // ── createCheckoutSession ───────────────────────────────────────
    if (action === "checkout") {
      // Founding-member claim. Single source of truth — the price the
      // customer pays is determined by the atomic SQL function, not
      // by anything the client says. The `tier` param from the body
      // is ignored except as analytics.
      //
      // claim_founding_slot returns one of:
      //   claimed / already_member → use $99 founding price
      //   cap_reached / forfeited  → use $149 standard price
      //   no_profile / bad_input   → caller bug, fail loud
      const claim = await adminClient().rpc("claim_founding_slot", {
        p_profile_id: profile.id,
      });
      if (claim.error) {
        console.error("[billing] claim_founding_slot RPC failed:", claim.error.message);
        return json({ error: "Checkout temporarily unavailable. Try again." });
      }
      const claimStatus = claim.data?.status;

      let priceTier: "founding" | "standard";
      if (claimStatus === "claimed" || claimStatus === "already_member") {
        priceTier = "founding";
      } else if (claimStatus === "cap_reached" || claimStatus === "forfeited") {
        priceTier = "standard";
      } else {
        console.error("[billing] unexpected claim status:", claimStatus);
        return json({ error: "Checkout state invalid. Contact support." });
      }
      const priceId = PRICES[priceTier];
      if (!priceId) {
        console.error("[billing] no price ID for tier:", priceTier);
        return json({ error: "Checkout configuration error. Contact support." });
      }

      // Find or create Stripe customer
      let customerId = profile.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || profile.email,
          name: profile.shop_name || profile.full_name || "",
          metadata: { profile_id: profile.id, auth_id: user.id },
        });
        customerId = customer.id;
        await updateProfileSecrets(adminClient(), profile.id, { stripe_customer_id: customerId });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}/Account?billing=success&tier=${priceTier}`,
        cancel_url: `${APP_URL}/Account?billing=cancelled`,
        subscription_data: {
          trial_period_days: profile.subscription_tier === "trial" ? 14 : undefined,
          // is_founding flag travels with the Stripe subscription so the
          // webhook (on cancel) can write founding_rate_forfeited back
          // to the right profile.
          metadata: {
            profile_id: profile.id,
            tier: priceTier,
            is_founding: priceTier === "founding" ? "true" : "false",
          },
        },
        allow_promotion_codes: true,
      });

      return json({ url: session.url });
    }

    // ── createPortalSession ─────────────────────────────────────────
    if (action === "portal") {
      if (!profile.stripe_customer_id) return json({ error: "No billing account" });

      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${APP_URL}/Account`,
      });

      return json({ url: session.url });
    }

    return json({ error: "Unknown action" });
  } catch (err) {
    console.error("billing error:", err);
    return json({ error: err.message }, 500);
  }
});
