import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";
import { claimWebhookEvent, extractBillingEventId } from "../_shared/webhookIdempotency.js";
import { sendApprovalNotification } from "../_shared/approvalNotificationEmail.js";
import { buildTrialWillEndEmail } from "../_shared/trialWillEndEmail.js";
import { partitionSecretUpdates } from "../_shared/connectionLogic.js";
import { updateProfileSecrets } from "../_shared/profileSecrets.ts";

// Prefer prod key over test — matches `billing/index.ts`. If both are set
// (during local testing), prod wins. Previously this preferred test, which
// would route prod webhook signature-verified events through the test SDK.
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || Deno.env.get("STRIPE_TEST_SECRET_KEY")!;
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

// Single plan — every price resolves to "shop". Includes the current
// standard/annual prices used by billing/index.ts plus the older IDs kept
// for in-flight subscriptions. Unknown prices fall back to the session/sub
// metadata tier, so a new price won't silently break the unlock.
const PRICE_TO_TIER: Record<string, string> = {
  "price_1TXDFwI4m9BGT2cwXHD6gVXZ": "shop", // $99/mo standard (current)
  "price_1TXDIZI4m9BGT2cwL3Xp2Vo9": "shop", // $999/yr annual (current)
  "price_1TR4wvI4m9BGT2cwt1kQ0fY3": "shop",
  "price_1TR508I4m9BGT2cwQt5bbznP": "shop",
  "price_1TR50AI4m9BGT2cwXUsKF6Ul": "shop",
};

// Resolve the profile id linked to a Stripe customer. stripe_customer_id
// lives in profile_secrets (moved off `profiles` in the secrets migration),
// so we must look it up there — NOT with `.from("profiles").eq("stripe_customer_id")`,
// which silently matched zero rows and left every subscriber stuck on "trial".
async function profileIdForCustomer(supabase: any, customerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profile_secrets")
    .select("profile_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) {
    console.error(`[billingWebhook] profile_secrets lookup failed for ${customerId}:`, error.message);
    return null;
  }
  return data?.profile_id ?? null;
}

// Apply an update to the right tables: subscription_tier/status/trial_ends_at
// → profiles; stripe_subscription_id/stripe_customer_id → profile_secrets.
async function updateProfileByCustomer(customerId: string, updates: Record<string, any>) {
  const supabase = adminClient();
  const profileId = await profileIdForCustomer(supabase, customerId);
  if (!profileId) {
    console.error(`[billingWebhook] no profile linked to stripe_customer_id ${customerId} — cannot apply ${JSON.stringify(updates)}`);
    return;
  }

  const { profileUpdates, secretUpdates } = partitionSecretUpdates(updates);

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabase.from("profiles").update(profileUpdates).eq("id", profileId);
    if (error) console.error("[billingWebhook] profiles update failed:", error.message);
  }
  if (Object.keys(secretUpdates).length > 0) {
    try {
      await updateProfileSecrets(supabase, profileId, secretUpdates);
    } catch (e: any) {
      console.error("[billingWebhook] profile_secrets update failed:", e?.message || e);
    }
  }
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
    const isFirstDelivery = await claimWebhookEvent(adminClient(), "billing", dedupId as string, event);
    if (!isFirstDelivery) {
      console.log(`[billingWebhook] Duplicate event ${dedupId} — skipping`);
      return new Response(JSON.stringify({ received: true, deduplicated: true }), { headers: CORS });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const tier = session.metadata?.tier || (session as any).subscription_data?.metadata?.tier || "shop";

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
        await updateProfileByCustomer(customerId, {
          subscription_tier: "expired",
          subscription_status: "canceled",
          stripe_subscription_id: null,
        });
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

      case "customer.subscription.trial_will_end": {
        // Stripe fires this 3 days before a subscription's trial ends.
        // Since billing/index.ts syncs the Stripe trial to whatever's
        // left of the in-app 14-day trial, this lands as a 3-day
        // warning email. Only reaches subs created via Stripe checkout
        // — never-subscribed-yet users are warned by the in-app banner
        // (src/components/TrialStatusBanner.jsx).
        //
        // Best-effort: a Resend failure must not return a non-2xx,
        // because Stripe would retry forever and we'd never advance
        // past this event.
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        try {
          const supabase = adminClient();
          // stripe_customer_id lives in profile_secrets — resolve the
          // profile id there, then read the notification fields off profiles.
          const profileId = await profileIdForCustomer(supabase, customerId);
          const { data: profile } = profileId
            ? await supabase
                .from("profiles")
                .select("shop_owner, shop_name, trial_ends_at")
                .eq("id", profileId)
                .maybeSingle()
            : { data: null };
          const recipient = profile?.shop_owner;
          if (recipient) {
            const trialEnd = sub.trial_end
              ? new Date(sub.trial_end * 1000)
              : (profile.trial_ends_at ? new Date(profile.trial_ends_at) : null);
            const trialEndsOn = trialEnd && Number.isFinite(trialEnd.getTime())
              ? trialEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
              : null;
            const { subject, html } = buildTrialWillEndEmail({
              shopName: profile.shop_name,
              trialEndsOn,
            } as any);
            await sendApprovalNotification({ to: recipient, subject, html } as any);
          } else {
            console.warn(`[billingWebhook] trial_will_end: no profile for customer ${customerId}`);
          }
        } catch (notifyErr) {
          console.error("[billingWebhook] trial_will_end notification failed:", notifyErr);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("billingWebhook error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
