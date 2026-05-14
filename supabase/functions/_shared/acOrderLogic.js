// Pure logic for acPlaceOrder, kept in JS so it's unit-testable under
// vitest without dragging in Deno globals. Anything that's a security
// or correctness contract for placing AS Colour orders lives here.
//
// If you change behavior, update __tests__/acOrderLogic.test.js — those
// tests are the canonical contract.

/**
 * Roles that may place AS Colour orders.
 *
 * - `admin` / `shop` — full access, the shop owner
 * - `manager` — "full shop access, no billing/admin" per CLAUDE.md;
 *   ordering blanks is operational, not billing/admin
 *
 * Excluded: `employee` (shop floor only), `broker` (own portal,
 * scoped by assigned_shops, no procurement role), `user` (pre-activation).
 *
 * Defense-in-depth on top of credsForOrderPlacement: a profile in an
 * excluded role that somehow has AC credentials configured still can't
 * trigger orders.
 */
export const ROLES_ALLOWED_TO_ORDER = Object.freeze(["admin", "shop", "manager"]);

export function canPlaceOrder(profile) {
  return ROLES_ALLOWED_TO_ORDER.includes(profile?.role);
}

/**
 * Pick the AS Colour credentials to use when PLACING AN ORDER.
 *
 * Critical: this MUST NOT fall back to platform env credentials. The
 * sister helper `credsFromProfile` in ascolour.ts intentionally does
 * fall back to env (catalog browsing for shops without their own keys
 * uses the platform's subscription key — that's fine, it just costs us
 * a quota hit). But order placement charges money to whichever AS Colour
 * account is on the request. If we let env be the fallback here, any
 * authenticated InkTracker user could trigger orders against the
 * PLATFORM's AS Colour account (i.e., Joe's personal account that's
 * configured in env vars).
 *
 * Returns the credentials only if all three required fields exist on
 * the shop's profile. Otherwise null — caller should refuse the request
 * with a clear "configure your own AS Colour keys first" message.
 */
export function credsForOrderPlacement(profile) {
  const subKey = profile?.ac_subscription_key;
  const email = profile?.ac_email;
  const password = profile?.ac_password;
  if (!subKey || !email || !password) return null;
  return { subKey, email, password };
}

/**
 * Validate the order payload the frontend sent. Returns an array of
 * human-readable error strings (empty array = valid).
 *
 * Mirrors the AS Colour /v1/orders contract: reference, shippingMethod,
 * shippingAddress with address1/city/zip/countryCode, and at least one
 * item with sku + quantity.
 */
export function validateOrderPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") {
    return ["payload must be an object"];
  }
  if (!payload.reference) errors.push("reference (PO number) is required");
  if (!payload.shippingMethod) {
    errors.push("shippingMethod is required (call /orders/shippingmethods to list)");
  }
  const sa = payload.shippingAddress;
  if (!sa || typeof sa !== "object") {
    errors.push("shippingAddress is required");
  } else {
    if (!sa.address1) errors.push("shippingAddress.address1 is required");
    if (!sa.city) errors.push("shippingAddress.city is required");
    if (!sa.zip) errors.push("shippingAddress.zip is required");
    if (!sa.countryCode) errors.push("shippingAddress.countryCode is required");
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    errors.push("at least one order item is required");
  } else {
    for (let i = 0; i < payload.items.length; i++) {
      const it = payload.items[i];
      if (!it?.sku) errors.push(`items[${i}].sku is required`);
      const qty = Number(it?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push(`items[${i}].quantity must be a positive number`);
      }
    }
  }
  return errors;
}

/**
 * Build the body to POST to AS Colour /v1/orders, normalising types and
 * applying defaults (orderNotes/courierInstructions default to empty
 * string; warehouse defaults to empty string per item).
 *
 * Assumes the payload has already passed validateOrderPayload.
 */
export function buildOrderRequestBody(payload) {
  return {
    reference: String(payload.reference),
    shippingMethod: String(payload.shippingMethod),
    orderNotes: payload.orderNotes != null ? String(payload.orderNotes) : "",
    courierInstructions:
      payload.courierInstructions != null ? String(payload.courierInstructions) : "",
    shippingAddress: payload.shippingAddress,
    items: payload.items.map((it) => ({
      sku: String(it.sku),
      warehouse: String(it.warehouse ?? ""),
      quantity: Number(it.quantity),
    })),
  };
}
