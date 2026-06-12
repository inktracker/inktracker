// Resolve the shop a user's data belongs to.
//
// THE BUG this fixes (2026-06-12, tester report): shop pages filtered
// and wrote data with `shop_owner: currentUser.email`. That's correct
// for an OWNER — their profile.shop_owner is null and their own email
// is the tenant key. But a MANAGER (or employee) has their OWN email,
// while the shop's data is keyed by the OWNER's email, stored on the
// manager's profile as `shop_owner`. So managers saw an empty shop, and
// anything they created got mis-tagged to their personal email.
//
// shopScope returns the right tenant key for any role:
//   owner   → shop_owner is null  → falls back to email (their own) ✓ no change
//   manager → shop_owner = owner's email → owner's email ✓ the fix
//   employee→ same as manager ✓
// Owners are unaffected (identical value), so this is a no-op for the
// common case and a fix for the broken one.
export function shopScope(user) {
  return user?.shop_owner || user?.email || null;
}
