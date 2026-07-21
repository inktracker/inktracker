import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";
import Stripe from "npm:stripe@14.25.0";
import { claimWebhookEvent, releaseWebhookEvent, extractBillingEventId } from "../_shared/webhookIdempotency.js";
import { sendAndLogApprovalNotification } from "../_shared/approvalNotificationEmail.js";
import { buildTrialWillEndEmail } from "../_shared/trialWillEndEmail.js";
import { buildCancellationScheduledEmail } from "../_shared/cancellationScheduledEmail.js";
import { buildWinBackEmail } from "../_shared/winBackEmail.js";
import { cancellationFieldsFromSubscription, isCancellationNewlyScheduled, pickLiveSubscription } from "../_shared/billingLogic.js";
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

// BILL-03: mark a subscription past_due and START its grace clock — but only on
// the TRANSITION into past_due. Stripe fires invoice.payment_failed on every
// dunning retry; stamping now() each time would keep resetting the 7-day window
// so it never elapsed. COALESCE keeps the first stamp.
async function markPastDue(customerId: string) {
  const supabase = adminClient();
  const profileId = await profileIdForCustomer(supabase, customerId);
  if (!profileId) {
    console.error(`[billingWebhook] no profile linked to ${customerId} — cannot mark past_due`);
    return;
  }
  const { data: prof } = await supabase
    .from("profiles").select("past_due_since").eq("id", profileId).maybeSingle();
  const updates: Record<string, any> = { subscription_status: "past_due" };
  if (!prof?.past_due_since) updates.past_due_since = new Date().toISOString();
  const { error } = await supabase.from("profiles").update(updates).eq("id", profileId);
  if (error) console.error("[billingWebhook] markPastDue update failed:", error.message);
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

// Persist the pending-cancellation display state, and — only on the false→true
// TRANSITION — send the "plan is set to end" email. Read-then-update by
// profileId mirrors markPastDue. Fully best-effort (mirrors trial_will_end): any
// read/update/email failure logs and swallows so the webhook still returns 2xx,
// otherwise Stripe retries forever and the run never advances. Purely additive
// display state — never touches the access gate (tier/status/trial fields).
async function captureCancellationState(customerId: string, sub: Stripe.Subscription) {
  try {
    const supabase = adminClient();
    const profileId = await profileIdForCustomer(supabase, customerId);
    if (!profileId) {
      console.error(`[billingWebhook] no profile linked to ${customerId} — cannot capture cancellation state`);
      return;
    }
    // Read the CURRENT flag first so we only email on the actual false→true
    // transition (Stripe fires 'updated' for many unrelated reasons).
    const { data: prof } = await supabase
      .from("profiles")
      .select("cancel_at_period_end, shop_owner, shop_name")
      .eq("id", profileId)
      .maybeSingle();
    const wasPending = Boolean(prof?.cancel_at_period_end);

    const fields = cancellationFieldsFromSubscription(sub);
    const { error } = await supabase.from("profiles").update(fields).eq("id", profileId);
    if (error) console.error("[billingWebhook] cancellation state update failed:", error.message);

    if (isCancellationNewlyScheduled(wasPending, fields.cancel_at_period_end) && prof?.shop_owner) {
      const endsAt = fields.subscription_ends_at ? new Date(fields.subscription_ends_at) : null;
      const endsOn = endsAt && Number.isFinite(endsAt.getTime())
        ? endsAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : null;
      const { subject, html } = buildCancellationScheduledEmail({ shopName: prof.shop_name, endsOn } as any);
      await sendAndLogApprovalNotification(supabase, {
        shop_owner: prof.shop_owner,
        event_type: "cancellation_scheduled",
        recipient_role: "shop_owner",
        to: prof.shop_owner,
        subject,
        html,
      } as any);
    }
  } catch (err) {
    console.error("[billingWebhook] captureCancellationState failed:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Hoisted so the outer catch can RELEASE the two-phase claim (see below).
  let dedupId: string | null = null;

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
      // constructEventAsync, NOT constructEvent: Deno's SubtleCrypto is
      // async-only, so the sync variant throws inside the signature check
      // and every real delivery 401s as "Invalid signature". Latent since
      // this function was written — no signed event ever reached it until
      // the live webhook destination was created (2026-07-21). The older
      // stripeWebhook already used the async variant.
      event = await stripe.webhooks.constructEventAsync(body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("[billingWebhook] signature verification failed:", err?.message);
      return new Response("Invalid signature", { status: 401, headers: CORS });
    }

    console.log(`[billingWebhook] ${event.type}`);

    // Idempotency. Stripe webhooks deliver at-least-once. Without
    // a dedup gate, a retry of customer.subscription.created could
    // fire the trial-activation side effects twice. Tests CW1–CW6
    // in _shared/__tests__/webhookIdempotency.test.js.
    dedupId = extractBillingEventId(event);
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
            past_due_since: null, // fresh active/trialing sub → clear any grace clock (BILL-03)
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const priceId = sub.items.data[0]?.price?.id || "";
        const tier = PRICE_TO_TIER[priceId] || sub.metadata?.tier || "shop";

        if (sub.status === "past_due") {
          // Stamp the grace clock (COALESCE — see markPastDue) and keep tier/sub id.
          await updateProfileByCustomer(customerId, {
            subscription_tier: tier,
            stripe_subscription_id: sub.id,
          });
          await markPastDue(customerId);
        } else {
          await updateProfileByCustomer(customerId, {
            subscription_tier: tier,
            subscription_status: sub.status,
            stripe_subscription_id: sub.id,
            // Recovered to active/trialing → clear the grace clock (BILL-03).
            ...(sub.status === "active" || sub.status === "trialing" ? { past_due_since: null } : {}),
          });
        }
        // After the status logic: capture the pending-cancellation display state.
        // Sets the fields when a cancel is scheduled, clears them if the shop
        // un-cancels (Stripe fires 'updated' with cancel_at_period_end:false),
        // and emails once on the false→true transition.
        await captureCancellationState(customerId, sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Duplicate-subscription guard (Kato, 2026-07-21): a double checkout
        // can leave a customer with TWO live subscriptions. Canceling the
        // duplicate fires this event — expiring the shop and sending the
        // win-back email to a still-paying customer. If any OTHER live sub
        // remains, repoint our record at it and stop. If the check itself
        // fails, fall through to the expiry path (old behavior).
        try {
          const remaining = await stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 10,
          });
          const live = pickLiveSubscription(remaining.data, sub.id);
          if (live) {
            const livePriceId = live.items?.data?.[0]?.price?.id || "";
            await updateProfileByCustomer(customerId, {
              subscription_tier: PRICE_TO_TIER[livePriceId] || "shop",
              subscription_status: live.status,
              stripe_subscription_id: live.id,
            });
            console.log(`[billingWebhook] ${sub.id} deleted but ${live.id} still live (${live.status}) — repointed, no expiry/win-back`);
            break;
          }
        } catch (e) {
          console.error("[billingWebhook] live-sub check failed — proceeding with expiry:", e);
        }

        await updateProfileByCustomer(customerId, {
          subscription_tier: "expired",
          subscription_status: "canceled",
          stripe_subscription_id: null,
          // The pending cancel is now REALIZED as expired — clear the display state.
          cancel_at_period_end: false,
          subscription_ends_at: null,
        });

        // Win-back email (best-effort, logged). Access has ended; data is saved,
        // one-click resubscribe. Mirrors trial_will_end's try/catch so a Resend
        // failure never 5xxes the webhook. A delayed drip can come later.
        try {
          const supabase = adminClient();
          const profileId = await profileIdForCustomer(supabase, customerId);
          const { data: profile } = profileId
            ? await supabase.from("profiles").select("shop_owner, shop_name").eq("id", profileId).maybeSingle()
            : { data: null };
          if (profile?.shop_owner) {
            const { subject, html } = buildWinBackEmail({ shopName: profile.shop_name });
            await sendAndLogApprovalNotification(supabase, {
              shop_owner: profile.shop_owner,
              event_type: "winback",
              recipient_role: "shop_owner",
              to: profile.shop_owner,
              subject,
              html,
            } as any);
          } else {
            console.warn(`[billingWebhook] winback: no profile for customer ${customerId}`);
          }
        } catch (notifyErr) {
          console.error("[billingWebhook] winback notification failed:", notifyErr);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Stamp past_due + start the grace clock (BILL-03). markPastDue COALESCEs
        // so repeated dunning failures don't reset the 7-day window.
        await markPastDue(customerId);
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
            // Logged variant — the raw send bypassed notification_log, so
            // trial reminders were invisible to the ops audit trail.
            await sendAndLogApprovalNotification(supabase, {
              shop_owner: recipient,
              event_type: "trial_reminder",
              recipient_role: "shop_owner",
              to: recipient,
              subject,
              html,
            } as any);
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
    // Two-phase claim: the claim was a RESERVATION. A side effect threw, so
    // release it before returning non-2xx — otherwise Stripe's retry would
    // find the event "already processed" and the subscription unlock / grace
    // clock / dunning effect would be permanently dropped. Releasing lets the
    // retry re-run the handler.
    await releaseWebhookEvent(adminClient(), "billing", dedupId as string);
    await captureError(err, { fn: "billingWebhook" });
    console.error("billingWebhook error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
