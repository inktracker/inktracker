// Pure builder for the quote→order conversion. Used by Quotes.jsx handleConvert.
//
// Carries forward fields that the order downstream needs (especially
// quote_id — without it, OrderDetailModal can't link back to the originating
// quote's invoice or message thread). Hardcoded defaults that match the
// pre-extraction inline shape are preserved so tests catch regressions.
//
// Both inputs (quote, user, now) are accepted by the caller; `now` is
// injected so tests can pin the order_id timestamp portion.

import { BROKER_MARKUP } from "../../components/shared/pricing";
import { effectiveQuoteTotals } from "../quotes/effectiveTotals";

function isBrokerQuote(q) {
  return Boolean(q?.broker_id || q?.broker_email || q?.brokerId);
}

export function generateOrderId(now = Date.now()) {
  const year = new Date(now).getFullYear();
  const suffix = now.toString(36).toUpperCase().slice(-5);
  return `ORD-${year}-${suffix}`;
}

/**
 * Build the payload for `base44.entities.Order.create()` from a quote.
 *
 * Invariants:
 *   - `quote_id` is set to quote.quote_id so OrderDetailModal can resolve
 *     the originating quote (for invoice lookup, message thread, header
 *     display). Forgetting this kills three features at once.
 *   - `deposit_paid` is carried forward (true if the customer paid a
 *     deposit on the quote — don't reset to false and risk a duplicate
 *     charge later).
 *   - `customer_email` is carried forward so the order has its own copy
 *     and doesn't depend on the Customer entity remaining unchanged.
 *   - Broker quotes use tax_rate=0 (broker markup absorbs tax) and
 *     swap customer_name/broker_client_name semantics, matching the
 *     pre-extraction behavior.
 *
 * @param {object} quote        the originating quote (must have line_items)
 * @param {object} opts
 * @param {string} opts.userEmail  the shop owner's email (becomes shop_owner)
 * @param {number} [opts.now]      injected clock for deterministic order_id
 * @returns {object} payload ready for Order.create()
 */
export function buildOrderFromQuote(quote, { userEmail = "", now = Date.now(), today } = {}) {
  const q = quote || {};
  // The order's own creation date (= the date the quote was approved/converted).
  // Stored as a shop-tz `date` string so order forms can show it without the
  // UTC-vs-shop-tz drift a raw created_at timestamp would have. Callers pass
  // `today = todayInShopTz()`; fall back to deriving it from `now` for tests
  // and any caller that doesn't.
  const orderDate = today || new Date(now).toISOString().split("T")[0];
  const brokerOrder = isBrokerQuote(q);
  const brokerDisplayName = q.broker_name || q.broker_company || q.broker_id || q.customer_name;
  const brokerClientName = q.customer_name || "";

  // Numbers-match: saved totals from send time win over a fresh live
  // recompute. The customer paid for the saved amount; the order
  // (and downstream invoice + QB sync) must inherit that, not a
  // re-priced value that may have drifted with pricing config changes.
  // Contract pinned in effectiveTotals tests ET1–ET8.
  const t = effectiveQuoteTotals(q, brokerOrder ? BROKER_MARKUP : undefined);

  return {
    order_id: generateOrderId(now),
    quote_id: q.quote_id || "",
    shop_owner: userEmail,
    broker_id: q.broker_id || "",
    broker_name: q.broker_name || "",
    broker_company: q.broker_company || "",
    customer_id: q.customer_id,
    customer_name: brokerOrder ? brokerDisplayName : q.customer_name,
    // Denormalize the customer's company so order surfaces (status page, art
    // approval, broker views) can render company-first without a customer
    // lookup — matching how quotes carry it. See feedback_company_name_first.
    company: q.company || "",
    customer_email: q.customer_email || "",
    broker_client_name: brokerOrder ? brokerClientName : "",
    job_title: q.job_title || "",
    date: q.date,
    order_date: orderDate,
    due_date: q.due_date || null,
    // Carry the setup/screen-fee total forward. The order's `total` already
    // includes it (effectiveQuoteTotals folds setup in), but downstream
    // buildQBInvoicePayload emits the "Setup & Screen Fees" QB line from THIS
    // field — drop it and the QuickBooks invoice silently under-bills by the
    // setup amount ($20–$200+). Prefer the quote's saved value (the saved-
    // totals contract); fall back to the live-computed setup when the quote
    // was converted pre-save (t.setup_total only populated on the live branch).
    setup_total: Number(q.setup_total) || Number(t.setup_total) || 0,
    // Carry one-off fees + the deposit percentage forward for the same reason
    // as setup_total: the order total already includes the fees, and the QB
    // invoice builder emits a line per additional charge and credits the
    // deposit. Drop these and the QuickBooks invoice diverges from the order
    // (under-bills the fees / over-charges by not crediting the deposit).
    // deposit_paid is already carried below.
    additional_charges: q.additional_charges ?? null,
    deposit_pct: q.deposit_pct ?? null,
    status: "Art Approval",
    line_items: q.line_items,
    notes: q.notes,
    rush_rate: q.rush_rate,
    extras: q.extras,
    discount: q.discount,
    discount_type: q.discount_type || "percent",
    tax_rate: brokerOrder ? 0 : q.tax_rate,
    subtotal: t.sub,
    tax: t.tax,
    total: t.total,
    paid: Boolean(q.paid),
    deposit_paid: Boolean(q.deposit_paid),
    selected_artwork: q.selected_artwork || [],
  };
}

/**
 * Build the patch applied to the originating quote when it's converted.
 * The quote is NEVER deleted — keeping the row preserves the audit
 * trail and the message-thread linkage that OrderDetailModal depends on.
 */
export function buildQuoteConvertedPatch(orderId, { now = Date.now() } = {}) {
  return {
    status: "Converted to Order",
    converted_order_id: orderId,
    converted_at: new Date(now).toISOString(),
  };
}
