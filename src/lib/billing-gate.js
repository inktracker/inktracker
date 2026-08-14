// Trial-expired / canceled-subscription gate.
//
// Wraps the existing getEffectiveTier + isReadOnly billing helpers in a
// React hook so call sites in the pages can drop in a one-line check
// before any mutation that would create new customer-visible work or
// fresh billable artifacts.
//
// Usage in a component:
//
//   const { gate } = useBillingGate();
//   async function saveQuote(q) {
//     if (gate("save quotes")) return;     // shows alert + blocks
//     ...                                   // proceeds if active
//   }
//
// The hook itself reads from AuthContext. Pages that hold their own
// user state (loaded via base44.auth.me) should pass that user via
// the userOverride arg so the gate decides off the freshest state.

import { useAuth } from "@/lib/AuthContext";
import { getEffectiveTier, computeReadOnly } from "@/lib/billing";
import { isNative } from "@/lib/mobile/native";
import { createPageUrl } from "@/utils";

// The Account billing deep-link every reactivate CTA points at.
export const REACTIVATE_HREF = createPageUrl("Account") + "?billing=1";

export function useBillingGate(userOverride) {
  const { user: ctxUser } = useAuth();
  const user = userOverride ?? ctxUser;
  const tier = getEffectiveTier(user);
  // Canonical rule (role bypass + governing sub) — matches the server gate.
  const readOnly = computeReadOnly(user);

  /**
   * Returns true if the caller should ABORT the mutation. Shows an
   * inline alert nudging the user to upgrade. Returns false when
   * subscription is active and the caller may proceed.
   *
   * @param {string} actionLabel  human-readable verb phrase, e.g.
   *                              "save quotes", "send this email"
   */
  function gate(actionLabel = "use this") {
    if (readOnly) {
      // alert() is the codebase's existing convention; a toast/modal
      // would be nicer but consistency wins for now.
      // Native (iOS) shows neutral copy: no purchase language or
      // upgrade steering in the app (App Review guideline 3.1.1).
      alert(isNative()
        ? `Your account is read-only, so you can't ${actionLabel} right now. Please manage your account from a computer.`
        : `Your trial has ended. Subscribe in Account → Plans to ${actionLabel}.`);
      return true;
    }
    return false;
  }

  return { tier, isReadOnly: readOnly, gate, user };
}

// Human-readable reason shown in tooltips / the banner when read-only.
function readOnlyReason(user) {
  // Native: one neutral sentence for every lapsed state — "reactivate"/
  // billing language stays off the device (guideline 3.1.1).
  if (isNative()) return "Your account is read-only. Manage your account from a computer.";
  const status = user?.subscription_status;
  const tier = getEffectiveTier(user);
  if (status === "past_due") {
    return "Your subscription is past due — reactivate to create and edit.";
  }
  if (user?.subscription_tier === "trial" || status === "trialing") {
    return "Your free trial has ended — reactivate to create and edit.";
  }
  if (user?.subscription_tier === "incomplete" || status === "incomplete") {
    return "Finish setting up billing to create and edit.";
  }
  // expired / canceled / anything else lapsed
  return "Your subscription has ended — reactivate to create and edit.";
}

/**
 * The ONE hook every create/edit affordance consults. Derives read-only state
 * from the canonical `computeReadOnly` rule (which mirrors the server gate),
 * so affordances disable honestly instead of letting a user click into a raw
 * DB rejection. No ad-hoc tier checks at call sites.
 *
 * @returns {{ readOnly: boolean, reason: string, reactivateHref: string }}
 */
export function useReadOnly(userOverride) {
  const { user: ctxUser } = useAuth();
  const user = userOverride ?? ctxUser;
  const readOnly = computeReadOnly(user);
  return {
    readOnly,
    reason: readOnly ? readOnlyReason(user) : "",
    reactivateHref: REACTIVATE_HREF,
  };
}
