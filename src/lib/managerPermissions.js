// Per-manager section access, controlled by the shop owner.
//
// Storage: profiles.manager_permissions (jsonb).
//   null/undefined → full access (default; existing managers unchanged)
//   { Quotes: true, Invoices: false, ... } → a section is allowed unless
//   its key is explicitly false.
//
// Only role='manager' is gated. Owners, admins, brokers, and employees
// are routed/handled elsewhere and always pass here.

// The gateable sections, in nav order. `page` matches the route/page
// name used by NAV + createPageUrl. `pricing` is a pseudo-section that
// gates the Account → Pricing tab rather than a top-level nav item.
export const MANAGER_SECTIONS = [
  { key: "Dashboard",   label: "Dashboard" },
  { key: "Quotes",      label: "Quotes" },
  { key: "Production",  label: "Production & Orders" },
  { key: "Customers",   label: "Customers" },
  { key: "Inventory",   label: "Inventory & Purchase Orders" },
  { key: "Invoices",    label: "Invoices" },
  { key: "Performance", label: "Performance & Reports" },
  { key: "Mockups",     label: "Mockups" },
  { key: "Team",        label: "Team roster (Admin panel — view only)" },
  { key: "Pricing",     label: "Pricing settings (Account → Pricing)" },
];

const SECTION_KEYS = new Set(MANAGER_SECTIONS.map((s) => s.key));

// Pages that share a section's permission (children + aliases).
const PAGE_TO_SECTION = {
  PurchaseOrders: "Inventory",
  Orders: "Production",
  Calendar: "Production",
  AdminPanel: "Team",
};

export function sectionForPage(page) {
  if (SECTION_KEYS.has(page)) return page;
  return PAGE_TO_SECTION[page] || null;
}

export function managerCanAccess(user, page) {
  // Only managers are gated by this mechanism.
  if (!user || user.role !== "manager") return true;
  const perms = user.manager_permissions;
  if (!perms || typeof perms !== "object") return true; // null = full access

  const section = sectionForPage(page);
  if (!section) return true; // ungated page (e.g. Account profile, ShopFloor)
  return perms[section] !== false;
}

// Owner-level access to a section, for actions that were previously gated to
// owners (delete, merge, admin/team management) but should open to a FULL-
// PARTNER manager. Owners/admins always pass; a manager passes only if their
// manager_permissions allow that section (so the owner can still dial it back).
// Brokers/employees never get owner-level access here.
//
// NOTE: this deliberately does NOT cover the two hard owner-only lines —
// managing the subscription and editing manager_permissions themselves — so a
// manager can never use it to escalate their own access.
export function hasOwnerAccess(user, section) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "shop") return true;
  if (user.role === "manager") return managerCanAccess(user, section);
  return false;
}

// First section a manager IS allowed to see — where to land them when
// their default page is denied.
export function firstAllowedPage(user) {
  for (const s of MANAGER_SECTIONS) {
    if (s.key === "Pricing") continue; // not a landing page
    if (managerCanAccess(user, s.key)) return s.key;
  }
  return "Account"; // always reachable (own profile/security)
}
