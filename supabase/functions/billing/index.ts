import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_TEST_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || Deno.env.get("VITE_APP_URL") || "https://www.inktracker.app";

// Single plan — update this price ID once the $49/mo product is created in Stripe
const PRICES: Record<string, string> = {
  shop: "price_1TR50AI4m9BGT2cwXUsKF6Ul",
};

const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
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
      const tier = body.tier;
      const priceId = PRICES[tier];
      if (!priceId) return json({ error: "Invalid tier" });

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
        success_url: `${APP_URL}/Account?billing=success&tier=${tier}`,
        cancel_url: `${APP_URL}/Account?billing=cancelled`,
        subscription_data: {
          trial_period_days: profile.subscription_tier === "trial" ? 14 : undefined,
          metadata: { profile_id: profile.id, tier },
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
