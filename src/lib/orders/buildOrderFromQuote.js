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
export function buildOrderFromQuote(quote, { userEmail = "", now = Date.now() } = {}) {
  const q = quote || {};
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
    customer_email: q.customer_email || "",
    broker_client_name: brokerOrder ? brokerClientName : "",
    job_title: q.job_title || "",
    date: q.date,
    due_date: q.due_date || null,
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
