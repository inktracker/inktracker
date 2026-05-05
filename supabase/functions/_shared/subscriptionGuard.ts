// Server-side subscription enforcement.
// Call requireActiveSubscription() at the top of any edge function that
// performs a paid operation (sending email, placing orders, etc.).
// Returns null if the subscription is active, or a Response to return
// immediately if expired/canceled.

const CORS = {
  "Access-Control-Allow-Origin": "https://www.inktracker.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Profile = {
  subscription_tier?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  [key: string]: any;
};

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

  // Past due — allow with warning (Stripe retries payment)
  if (status === "past_due") {
    return null;
  }

  // No tier set at all (pre-activation user) — block
  return new Response(
    JSON.stringify({ error: "No active subscription found." }),
    { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
  );
}
