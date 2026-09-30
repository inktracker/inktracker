// Should a QB-token lookup fall back from this profile to the SHOP OWNER's
// QuickBooks connection?
//
// A team member (manager / employee) has no QB connection of their own — the
// shop's connection lives on the OWNER's profile_secrets, so their
// checkConnection / invoicing / metrics use the SHOP's tokens. That fallback
// is intended for them.
//
// A BROKER must NEVER fall back to the shop's tokens. A broker is an external
// reseller; inheriting the shop's QB session would let them read the shop's
// financials, record payments, and create invoices in the shop's books (the
// P1 security hole, 2026-08-13). A broker uses ONLY their own QuickBooks
// connection — if they have one, it's on their own profile_secrets; if they
// don't, they are simply "not connected" (they do NOT borrow the shop's).
//
// So the fallback fires only when the profile: has no QB token of its own,
// has a shop_owner (i.e. is attached to a shop), AND is not a broker.
export function shouldUseOwnerQbFallback(profile) {
  if (!profile) return false;
  if (profile.qb_access_token) return false;      // has its own connection
  if (!profile.shop_owner) return false;          // not attached to a shop
  if (profile.role === "broker") return false;    // brokers never borrow the shop's QB
  return true;
}
