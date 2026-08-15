// Anonymous-response sanitization (broker security audit 2026-08-13, P1).
//
// The token-gated customer pages (QuotePayment / OrderStatus / ArtApproval)
// receive JSON anyone with the link can read in dev tools. The UI hiding a
// field is not a defense — the RESPONSE must not carry what the customer
// (or a broker's end client) must never see:
//   • the shop's raw costs (garmentCost* on line items) — leaks to ALL
//     customers,
//   • on BROKER quotes: the shop's identity/contact, wholesale qb_* totals,
//     the shop's PAYABLE QB links, and shop-internal notes,
//   • Stripe account identifiers on the shop payload.
//
// Pure functions, unit-tested in __tests__/publicSafe.test.js. Keep the
// strip lists in lockstep with what the pages actually consume — the
// consumers are documented per function.

const COST_KEY_RE = /cost/i;
// Partner-sourcing keys (Phase 2b) are shop-internal: partner_source is the
// SUBCONTRACTOR's email (blind-handoff privacy) and _partner_ppp is the shop's
// per-piece COST. _partner_cost also matches COST_KEY_RE, but strip the whole
// family here so a rename can't silently re-leak one. No customer surface
// consumes any partner_* field.
const PARTNER_KEY_RE = /^_?partner(_|$)/i;

/** True when the quote belongs to a broker (mirrors src/lib isBrokerQuote). */
export function isBrokerDoc(doc) {
  return Boolean(doc?.broker_id || doc?.broker_email);
}

/** Strip shop-cost keys from a line-items array (never mutates input). */
export function sanitizeLineItems(lineItems) {
  if (!Array.isArray(lineItems)) return lineItems;
  return lineItems.map((li) => {
    if (!li || typeof li !== "object") return li;
    const out = {};
    for (const [k, v] of Object.entries(li)) {
      if (COST_KEY_RE.test(k) || PARTNER_KEY_RE.test(k)) continue;
      out[k] = v;
    }
    return out;
  });
}

// qb_* money mirrors + payable links: needed by DIRECT customers (the page
// routes payment through qb_payment_link / qb_deposit_payment_link and
// renders QB-authoritative totals). NEVER sent on broker quotes — the end
// client must not see the shop's wholesale invoice or be able to pay it.
const BROKER_STRIPPED_QUOTE_KEYS = [
  "qb_payment_link",
  "qb_deposit_payment_link",
  "qb_invoice_id",
  "qb_deposit_invoice_id",
  "qb_total",
  "qb_subtotal",
  "qb_tax_amount",
  "qb_doc_number",
  "notes", // shop-internal on broker quotes; client PDF already hides it
];

/**
 * Sanitize a quote row for the anonymous payment page. Call AFTER
 * toCustomerFacingQuote/public_token handling — this only strips.
 */
export function sanitizeQuoteForCustomer(quote) {
  if (!quote) return quote;
  const out = { ...quote, line_items: sanitizeLineItems(quote.line_items) };
  if (isBrokerDoc(quote)) {
    for (const k of BROKER_STRIPPED_QUOTE_KEYS) delete out[k];
  }
  return out;
}

// OrderStatus consumes: order_id, status, job_title, date, due_date,
// line_items (titles/sizes for the summary). ArtApproval additionally:
// selected_artwork, art_approved, art_approved_by, art_approved_at,
// customer_name, shop_owner (branding lookup server-side only — still safe
// to include as it's an email the customer already corresponds with — but
// NOT for broker orders). Everything else on the raw row (totals, checklist
// with internal marks, notes, broker wholesale fields, assigned operator)
// stays server-side.
const PUBLIC_ORDER_FIELDS = [
  "id",
  "order_id",
  "status",
  "job_title",
  "date",
  "due_date",
  "customer_name",
  "selected_artwork",
  "art_approved",
  "art_approved_by",
  "art_approved_at",
  "broker_id",
  "broker_name",
  "broker_company",
];

/** Allowlist an order row for the anonymous status/approval pages. */
export function sanitizeOrderForCustomer(order) {
  if (!order) return order;
  const out = {};
  for (const k of PUBLIC_ORDER_FIELDS) {
    if (order[k] !== undefined) out[k] = order[k];
  }
  out.line_items = sanitizeLineItems(order.line_items);
  return out;
}

/**
 * The brand/contact payload the anonymous pages render. For broker docs
 * the BROKER is the merchant of record: broker identity + broker logo,
 * never the shop's name/logo/contact (white-label rule). Stripe fields
 * never leave the server.
 *
 * @param {object} args.shop merged shop+ownerProfile object (server-side)
 * @param {object} args.doc quote or order row
 * @param {object|null} args.brokerProfile broker's profiles row (logo_url)
 */
export function customerFacingShopPayload({ shop, doc, brokerProfile }) {
  if (isBrokerDoc(doc)) {
    return {
      shop_name: (doc.broker_company || doc.broker_name || "").trim() || "Your vendor",
      logo_url: brokerProfile?.logo_url ?? null,
      email: doc.broker_id || doc.broker_email || null,
      phone: brokerProfile?.phone ?? null,
      address: null, city: null, state: null, zip: null, website: null,
    };
  }
  if (!shop) return shop;
  const { stripe_account_id: _a, stripe_account_status: _b, owner_email: _c, ...rest } = shop;
  return rest;
}
