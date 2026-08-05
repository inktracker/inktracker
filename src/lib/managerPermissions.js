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

// ── Role templates ──────────────────────────────────────────────────────────
// One-click permission presets matching how a 4-20 person shop actually
// staffs: instead of the owner reasoning through ten checkboxes per
// hire, they pick the job. Each template is just a manager_permissions
// map + the hide_money flag — applying one then tweaking checkboxes is
// fully supported (templates are a starting point, not a mode).
//
// Section keys omitted from `deny` stay allowed (the storage contract:
// a section is allowed unless explicitly false).
const deny = (...keys) => Object.fromEntries(keys.map((k) => [k, false]));

export const ROLE_TEMPLATES = [
  {
    key: "front_office",
    label: "Front office / CSR",
    blurb: "Quotes, customers, and production visibility. No financials or settings.",
    permissions: deny("Invoices", "Performance", "Pricing", "Team"),
    hideMoney: false, // CSRs quote — they need prices.
  },
  {
    key: "art",
    label: "Art department",
    blurb: "Mockups and production only, with money hidden.",
    permissions: deny("Quotes", "Customers", "Invoices", "Performance", "Inventory", "Pricing", "Team"),
    hideMoney: true,
  },
  {
    key: "production_lead",
    label: "Production lead",
    blurb: "Production, inventory, purchasing, and the team roster. No quoting or financials.",
    permissions: deny("Quotes", "Invoices", "Performance", "Pricing"),
    hideMoney: false,
  },
  {
    key: "books",
    label: "Bookkeeper",
    blurb: "Invoices, performance, and customers. No production or quoting.",
    permissions: deny("Quotes", "Production", "Inventory", "Mockups", "Pricing", "Team"),
    hideMoney: false,
  },
  {
    key: "full",
    label: "Full partner",
    blurb: "Everything except billing and team permissions (owner-only).",
    permissions: null, // null = full access, the storage default
    hideMoney: false,
  },
];

// ── Money visibility ────────────────────────────────────────────────────────
// Display-level gate for prices/costs/margins on production surfaces
// (Production board, Orders, order detail). Deliberately a courtesy /
// professionalism control — "no margins on the press-side screen" — not
// a security boundary: the enforcement layer for DATA access is
// manager_permissions + RLS. A hide_money user with the Production
// section can still query order totals with their JWT; a user who must
// not ACCESS financials should have Invoices/Performance denied, which
// RLS enforces server-side.
export function canSeeMoney(user) {
  return user?.hide_money !== true;
}
