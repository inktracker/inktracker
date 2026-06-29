// Shop-data purge plan + authorization (audit PRIV-01).
//
// Account deletion historically removed only the auth user + profile row, so
// every tenant row (customers, quotes, invoices, certs, …) — keyed by the
// shop owner's EMAIL with no FK cascade — survived forever, orphaned. The
// Privacy Policy promises deletion within 30 days (GDPR Art.17 / CCPA).
//
// This module is the single, tested source of truth for WHAT a full purge
// touches, and WHO may trigger one. The destructive IO lives in adminAction's
// `purgeShopData` action; it is dry-run by default.

// Every table holding a shop's data, with the column that equals the shop
// owner's email. Listed children-ish first; all are keyed independently by
// the owner email (no inter-table FKs — see DB-03), so order is not load-
// bearing, but we keep customers/quotes/orders late for readability.
export const SHOP_PURGE_TABLES = Object.freeze([
  { table: "commissions",      column: "shop_owner" },
  { table: "tax_records",      column: "shop_owner" },
  { table: "notification_log", column: "shop_owner" },
  { table: "notifications",    column: "shop_owner" },
  { table: "messages",         column: "shop_owner" },
  { table: "invoices",         column: "shop_owner" },
  { table: "purchase_orders",  column: "shop_owner" },
  { table: "payment_accounts", column: "shop_owner" },
  { table: "payees",           column: "shop_owner" },
  { table: "expenses",         column: "shop_owner" },
  { table: "inventory_items",  column: "shop_owner" },
  { table: "shop_performance", column: "shop_owner" },
  { table: "tax_categories",   column: "shop_owner" },
  { table: "orders",           column: "shop_owner" },
  { table: "quotes",           column: "shop_owner" },
  { table: "customers",        column: "shop_owner" },
  { table: "shops",            column: "owner_email" },
]);

// Private storage prefixes to clear (objects live under "<shop_owner>/…").
// tax-certificates is SEC-01-prefixed; artwork purge is a follow-up (its
// paths aren't shop-scoped yet, so deleting by prefix isn't safe here).
export const SHOP_PURGE_BUCKETS = Object.freeze(["tax-certificates"]);

/**
 * May `caller` purge the shop owned by `targetEmail`?
 *   - platform admin: yes (any shop)
 *   - the shop owner themselves: yes (own shop only) — callerShop is the
 *     caller's resolved tenant key (shopScope: own email for an owner)
 *   - anyone else: no
 * `confirm` must exactly equal `targetEmail` — a typed confirmation that
 * guards against accidental/parameter-confused calls to a destructive action.
 *
 * @returns {{ ok: true } | { ok: false, reason: "no_target"|"confirm_mismatch"|"forbidden" }}
 */
export function authorizeShopPurge({ callerRole, callerShop, targetEmail, confirm } = {}) {
  const target = String(targetEmail ?? "").trim().toLowerCase();
  if (!target) return { ok: false, reason: "no_target" };
  if (String(confirm ?? "").trim().toLowerCase() !== target) {
    return { ok: false, reason: "confirm_mismatch" };
  }
  if (callerRole === "admin") return { ok: true };
  if (String(callerShop ?? "").trim().toLowerCase() === target) return { ok: true };
  return { ok: false, reason: "forbidden" };
}
