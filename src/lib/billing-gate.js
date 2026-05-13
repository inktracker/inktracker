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
import { getEffectiveTier, isReadOnly } from "@/lib/billing";

export function useBillingGate(userOverride) {
  const { user: ctxUser } = useAuth();
  const user = userOverride ?? ctxUser;
  const tier = getEffectiveTier(user);
  const readOnly = isReadOnly(tier, user?.subscription_status);

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
      alert(`Your trial has ended. Subscribe in Account → Plans to ${actionLabel}.`);
      return true;
    }
    return false;
  }

  return { tier, isReadOnly: readOnly, gate, user };
}
