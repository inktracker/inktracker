// Pure logic for interpreting claim_founding_slot RPC responses
// and deciding which Stripe price tier to use.
//
// As of 2026-05-16: founding rate $50/mo, standard $99/mo or $999/yr.
// Annual SKU is a parallel price handled separately in the edge
// function — does NOT consume a founding slot.
//
// Cap was tightened 50 → 10 on 2026-05-16 (smaller, hand-curated
// founding cohort). SQL function updated in
// 20260603_founding_cap_to_10.sql; this constant must match.
//
// The RPC returns a jsonb status — one of:
//
//   claimed         — new claim, $50 founding
//   already_member  — re-call by same profile (idempotent), $50
//   cap_reached     — 10 slots full, $99 standard
//   forfeited       — previously canceled a founding sub, $99
//   no_profile      — caller bug
//   bad_input       — caller bug
//
// Caller (the billing edge function) maps the tier to a Stripe price
// ID. This helper is the strict contract so the edge function can't
// drift from the SQL function's behavior.

export const FOUNDING_MEMBER_CAP = 10;

export const PRICE_TIER = Object.freeze({
  FOUNDING: "founding", // $50/mo, slot-limited
  STANDARD: "standard", // $99/mo, default after cap or after forfeit
});

/**
 * Map a claim_founding_slot RPC response into a price-tier decision.
 *
 * @param {object|null} rpcData   the `data` from supabase.rpc(...)
 * @returns {{ tier: 'founding'|'standard'|null, reason: string, isError: boolean }}
 *   tier:   the price tier to use, or null if caller should fail loud
 *   reason: short status string for logging
 *   isError: true when caller should abort (caller bug or unexpected status)
 */
export function decidePriceTier(rpcData) {
  if (!rpcData || typeof rpcData !== "object") {
    return { tier: null, reason: "no_data", isError: true };
  }
  switch (rpcData.status) {
    case "claimed":
    case "already_member":
      return { tier: PRICE_TIER.FOUNDING, reason: rpcData.status, isError: false };
    case "cap_reached":
    case "forfeited":
      return { tier: PRICE_TIER.STANDARD, reason: rpcData.status, isError: false };
    case "no_profile":
    case "bad_input":
      // Caller bugs — refuse to proceed. The billing edge function
      // surfaces this to the user as "Checkout state invalid."
      return { tier: null, reason: rpcData.status, isError: true };
    default:
      return { tier: null, reason: `unknown:${rpcData.status}`, isError: true };
  }
}
