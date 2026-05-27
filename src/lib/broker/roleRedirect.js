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

// Pages a broker is allowed to view directly. Brokers landing anywhere
// else get bounced back to BrokerDashboard. The shop-side routes in
// this list (Quotes, Orders, Customers, Invoices, Messages,
// Performance) have role-dispatch wrappers in pages.config.js so they
// render the broker's version when role === "broker". Added 2026-05-27
// for the broker-portal mirrors-shop-layout refactor; expanded one
// route at a time as each section's dispatcher is wired up.
const BROKER_ALLOWED_PAGES = [
  "BrokerDashboard",
  "Quotes",
];

export function resolveRoleRedirect(user, currentPageName) {
  if (!user) return null;
  const role = user.role;

  if (role === "broker") {
    return BROKER_ALLOWED_PAGES.includes(currentPageName) ? null : "BrokerDashboard";
  }
  if (role === "employee") {
    return currentPageName === "ShopFloor" ? null : "ShopFloor";
  }
  // shop / admin / manager / user — no role-driven redirect.
  return null;
}
