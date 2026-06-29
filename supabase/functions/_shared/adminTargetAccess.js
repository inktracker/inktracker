// Pure tenant-access predicate for adminAction's `setRole` and `deleteUser`.
//
// Before this helper existed, both call sites had inline `if (targetProfile) { isOwnShop check }`
// blocks. When the DB lookup returned null (e.g. an authId with no profile, or
// a non-existent profileId), the `if` was skipped and the action proceeded
// unguarded — letting any authenticated caller call `deleteUser` with another
// auth user's UUID, or `setRole` to claim an orphan auth user into their shop.
//
// This predicate refuses on null targets so callers fail closed.
//
// Returns:
//   { ok: true }                — caller may proceed
//   { ok: false, reason: "not_found" }   — target doesn't exist (404 by caller)
//   { ok: false, reason: "cross_shop" }  — target belongs to a different shop (403 by caller)
//
// The "ownership" predicate accepts three sources of evidence — the same three
// the original inline checks used:
//   1. target.shop_owner === adminEmail            (target is in caller's shop)
//   2. target.assigned_shops includes adminEmail   (caller is a broker/manager assigned to target's shop)
//   3. target.email === adminEmail                 (target is the caller themself — self-modification is OK)

export function checkAdminTargetAccess({ targetProfile, adminEmail } = {}) {
  if (!targetProfile) {
    return { ok: false, reason: "not_found" };
  }
  if (!adminEmail) {
    // Defensive: a caller with no admin email can't claim any tenant scope.
    // Reaching this branch means upstream auth derivation failed silently;
    // refuse rather than match against an empty string.
    return { ok: false, reason: "cross_shop" };
  }

  const shopOwnerMatch = targetProfile.shop_owner === adminEmail;
  const assignedMatch =
    Array.isArray(targetProfile.assigned_shops) &&
    targetProfile.assigned_shops.includes(adminEmail);
  const selfMatch = targetProfile.email === adminEmail;

  if (shopOwnerMatch || assignedMatch || selfMatch) {
    return { ok: true };
  }
  return { ok: false, reason: "cross_shop" };
}

// Roles that setRole is allowed to assign (audit SEC-06). 'admin' is the
// platform-staff role that bypasses subscription gates and tenant scoping —
// it must NEVER be mintable through the app (a shop owner could otherwise
// promote an in-shop user to admin). Provision real admins out-of-band (SQL).
// Everything else assignable here is tenant-scoped.
export const ASSIGNABLE_ROLES = Object.freeze(["shop", "manager", "employee", "broker", "user"]);

export function isAssignableRole(role) {
  return ASSIGNABLE_ROLES.includes(role);
}
