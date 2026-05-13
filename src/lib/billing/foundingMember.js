// Pure logic for interpreting claim_founding_slot RPC responses
// and deciding which Stripe price tier to use.
//
// The RPC (in 20260520_founding_member_program.sql) returns a jsonb
// status — one of:
//
//   claimed         — new claim, $99 founding
//   already_member  — re-call by same profile (idempotent), $99
//   cap_reached     — 50 slots full, $149 standard
//   forfeited       — previously canceled a founding sub, $149
//   no_profile      — caller bug
//   bad_input       — caller bug
//
// Caller (the billing edge function) maps the tier to a Stripe price
// ID. This helper is the strict contract so the edge function can't
// drift from the SQL function's behavior.

export const FOUNDING_MEMBER_CAP = 50;

export const PRICE_TIER = Object.freeze({
  FOUNDING: "founding", // $99/mo, slot-limited
  STANDARD: "standard", // $149/mo, default after cap or after forfeit
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
