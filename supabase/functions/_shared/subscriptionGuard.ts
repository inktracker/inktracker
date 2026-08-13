// Server-side subscription enforcement.
// Call requireActiveSubscription() at the top of any edge function that
// performs a paid operation (sending email, placing orders, etc.).
// Returns null if the subscription is active, or a Response to return
// immediately if expired/canceled.

import { pastDueGraceElapsed } from "./billingLogic.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Profile = {
  subscription_tier?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  [key: string]: any;
};

/**
 * Team-aware guard (broker security audit 2026-08-13, P1): team members
 * (manager / employee / broker) ride the SHOP's subscription — their own
 * profile carries an inert tier (house rule: never gate by the member's
 * own tier; 20260926 migration calls team tiers "inert"). Resolve the
 * owner's profile via profile.shop_owner and guard THAT. Falls back to
 * guarding the member's own profile when no owner row resolves (fails
 * toward the old behavior, never more permissive for owners themselves —
 * owners have no shop_owner).
 *
 * `admin` must be a service-role client: the caller's RLS may not permit
 * reading the owner's profile row.
 */
export async function requireActiveTeamSubscription(admin: any, profile: Profile | null): Promise<Response | null> {
  const ownerEmail = profile?.shop_owner;
  if (ownerEmail) {
    try {
      const { data: owner } = await admin
        .from("profiles")
        .select("subscription_tier, subscription_status, trial_ends_at, past_due_since")
        .eq("email", ownerEmail)
        .maybeSingle();
      if (owner) return requireActiveSubscription(owner);
    } catch (_e) {
      // fall through to own-profile guard
    }
  }
  return requireActiveSubscription(profile);
}

/**
 * Checks if a profile has an active subscription (paid or valid trial).
 * Returns null if active, or a 403 Response if expired/canceled.
 */
export function requireActiveSubscription(profile: Profile | null): Response | null {
  if (!profile) {
    return new Response(
      JSON.stringify({ error: "Profile not found" }),
      { status: 404, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  const tier = profile.subscription_tier || "";
  const status = profile.subscription_status || "";

  // Expired or canceled — always blocked
  if (tier === "expired" || status === "canceled") {
    return new Response(
      JSON.stringify({ error: "Your subscription has expired. Please renew to continue." }),
      { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  // 'incomplete' = signed up but never added a card / started a subscription
  // (BILL-01). Block until they complete Stripe Checkout. Without this, the
  // "any truthy tier" allow below would let a never-paid signup use paid edge
  // functions.
  if (tier === "incomplete") {
    return new Response(
      JSON.stringify({ error: "Add a payment method to start your free trial." }),
      { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  // Trial — check if still within the trial window
  if (tier === "trial") {
    const trialEnd = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
    if (trialEnd && trialEnd < new Date()) {
      return new Response(
        JSON.stringify({ error: "Your free trial has ended. Subscribe to keep using InkTracker." }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    // Trial still active — allow
    return null;
  }

  // Active paid subscription (shop tier) — allow
  if (tier && status !== "past_due") {
    return null;
  }

  // Past due — allow during the grace window (Stripe retries payment), then
  // block writes once grace is exhausted (BILL-03: read-only after 7 days).
  if (status === "past_due") {
    if (pastDueGraceElapsed(profile)) {
      return new Response(
        JSON.stringify({ error: "Your subscription payment is past due. Update your card to keep making changes — your account is read-only until it's resolved." }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    return null;
  }

  // No tier set at all (pre-activation user) — block
  return new Response(
    JSON.stringify({ error: "No active subscription found." }),
    { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
  );
}
