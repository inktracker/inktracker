import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { claimWebhookEvent, extractBillingEventId } from "../_shared/webhookIdempotency.js";

const STRIPE_KEY = Deno.env.get("STRIPE_TEST_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_BILLING_WEBHOOK_SECRET") || "";
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Single plan — all prices resolve to "shop"
const PRICE_TO_TIER: Record<string, string> = {
  "price_1TR4wvI4m9BGT2cwt1kQ0fY3": "shop",
  "price_1TR508I4m9BGT2cwQt5bbznP": "shop",
  "price_1TR50AI4m9BGT2cwXUsKF6Ul": "shop",
};

async function updateProfileByCustomer(customerId: string, updates: Record<string, any>) {
  const supabase = adminClient();
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("stripe_customer_id", customerId);
  if (error) console.error("Profile update failed:", error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    // Fail closed — never process an event without a verified Stripe signature.
    // If STRIPE_WEBHOOK_SECRET isn't configured, that's an ops error, not an
    // excuse to trust unsigned input.
    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("[billingWebhook] STRIPE_WEBHOOK_SECRET not configured — refusing to process");
      return new Response("Webhook misconfigured", { status: 500, headers: CORS });
    }
    if (!sig) {
      return new Response("Missing stripe-signature header", { status: 401, headers: CORS });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("[billingWebhook] signature verification failed:", err?.message);
      return new Response("Invalid signature", { status: 401, headers: CORS });
    }

    console.log(`[billingWebhook] ${event.type}`);

    // Idempotency. Stripe webhooks deliver at-least-once. Without
    // a dedup gate, a retry of customer.subscription.created could
    // fire the trial-activation side effects twice. Tests CW1–CW6
    // in _shared/__tests__/webhookIdempotency.test.js.
    const dedupId = extractBillingEventId(event);
    const isFirstDelivery = await claimWebhookEvent(adminClient(), "billing", dedupId, event);
    if (!isFirstDelivery) {
      console.log(`[billingWebhook] Duplicate event ${dedupId} — skipping`);
      return new Response(JSON.stringify({ received: true, deduplicated: true }), { headers: CORS });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const tier = session.metadata?.tier || session.subscription_data?.metadata?.tier || "shop";

        // Get subscription to find the tier from price
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price?.id || "";
          const resolvedTier = PRICE_TO_TIER[priceId] || tier;

          await updateProfileByCustomer(customerId, {
            subscription_tier: resolvedTier,
            subscription_status: sub.status === "trialing" ? "trialing" : "active",
            stripe_subscription_id: subscriptionId,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const priceId = sub.items.data[0]?.price?.id || "";
        const tier = PRICE_TO_TIER[priceId] || sub.metadata?.tier || "shop";

        await updateProfileByCustomer(customerId, {
          subscription_tier: tier,
          subscription_status: sub.status,
          stripe_subscription_id: sub.id,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Founding-member forfeit. When the canceled subscription was
        // on the founding rate (metadata.is_founding=true OR profile
        // currently flagged is_founding_member), set
        // founding_rate_forfeited=true so claim_founding_slot refuses
        // any re-signup. The forfeit is permanent — re-signups always
        // pay the standard $149 rate.
        const wasFounding = sub.metadata?.is_founding === "true";
        const updates: Record<string, unknown> = {
          subscription_tier: "expired",
          subscription_status: "canceled",
          stripe_subscription_id: null,
        };
        if (wasFounding) {
          updates.founding_rate_forfeited = true;
          updates.is_founding_member = false;
        }
        await updateProfileByCustomer(customerId, updates);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await updateProfileByCustomer(customerId, {
          subscription_status: "past_due",
        });
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("billingWebhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
