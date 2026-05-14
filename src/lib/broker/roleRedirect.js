// Pure-logic version of the role-based redirect that runs in
// Layout.jsx's useEffect. Tells the caller WHERE the user should be
// routed given their role + the page they're on. Returns:
//   null      → no redirect needed; render the current page
//   "<page>"  → redirect to this page name (caller does the navigation)
//
// Defensive boundary check: keeps the security-relevant "brokers stay
// in their portal, employees stay on the shop floor" rule out of an
// effect-buried `if` chain and into something we can unit-test for
// every role × page matrix.

export function resolveRoleRedirect(user, currentPageName) {
  if (!user) return null;
  const role = user.role;

  if (role === "broker") {
    return currentPageName === "BrokerDashboard" ? null : "BrokerDashboard";
  }
  if (role === "employee") {
    return currentPageName === "ShopFloor" ? null : "ShopFloor";
  }
  // shop / admin / manager / user — no role-driven redirect.
  return null;
}
