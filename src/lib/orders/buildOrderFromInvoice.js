// Pure logic for "Add to Production" — putting a QB-originated invoice
// onto the production schedule by creating an order from it.
//
// Orders are the ONLY scheduling entity (Production table / calendar /
// schedule all read orders). Invoices imported from QuickBooks arrive
// with order_id=null, so QB-first jobs are invisible to production
// until they're bridged. This module decides WHETHER a bridge is safe
// (decideAddToProduction) and builds the order payload when it is
// (buildOrderFromInvoice).
//
// Duplicate-prevention contract:
//   - An invoice already linked to an order (order_id set) is never
//     re-bridged.
//   - An invoice born from an InkTracker quote is NEVER bridged by
//     creating a new order — the quote's own convert flow owns that
//     order. If the quote is already converted we LINK the invoice to
//     the existing order; if not, we refuse and point at the quote.
//   - The caller must pass FRESH rows (refetch before deciding) — the
//     decision is only as good as its inputs.

import { generateOrderId } from "./buildOrderFromQuote";

export const ADD_TO_PRODUCTION = Object.freeze({
  CREATE:          "create",           // safe to create a new order
  LINK_EXISTING:   "link-existing",    // quote-born + converted → link, don't create
  BLOCKED_QUOTE:   "blocked-quote",    // quote-born, unconverted → use the quote flow
  ALREADY_LINKED:  "already-linked",   // invoice.order_id set → nothing to do
});

/**
 * Decide how to put an invoice on the production schedule without
 * creating a duplicate order.
 *
 * @param {object} invoice          FRESH invoice row (refetched at click time)
 * @param {Array<object>} matchingQuotes  quotes matching this invoice by
 *        qb_invoice_id OR quote_id === invoice.invoice_id (caller queries both)
 * @returns {{action: string, orderId?: string, quote?: object}}
 */
export function decideAddToProduction(invoice, matchingQuotes) {
  if (invoice?.order_id) {
    return { action: ADD_TO_PRODUCTION.ALREADY_LINKED, orderId: invoice.order_id };
  }
  const quotes = Array.isArray(matchingQuotes) ? matchingQuotes.filter(Boolean) : [];
  // Prefer a converted quote (it carries the order pointer). Any match at
  // all means the invoice is quote-born and a create would duplicate.
  const converted = quotes.find((q) => q.converted_order_id);
  if (converted) {
    return {
      action: ADD_TO_PRODUCTION.LINK_EXISTING,
      orderId: converted.converted_order_id,
      quote: converted,
    };
  }
  if (quotes.length > 0) {
    return { action: ADD_TO_PRODUCTION.BLOCKED_QUOTE, quote: quotes[0] };
  }
  return { action: ADD_TO_PRODUCTION.CREATE };
}

/**
 * Build the payload for `base44.entities.Order.create()` from an
 * imported invoice row.
 *
 * Invariants:
 *   - `quote_id` stays EMPTY. There is no originating quote; the
 *     invoice's order_id backlink (written by the caller right after
 *     create) is the single source of linkage, and it's what the paid
 *     cascade (cascadeMarkInvoicePaid) walks.
 *   - Money fields are copied verbatim from the invoice — QB is
 *     authoritative for these rows and the order must not re-price.
 *   - `paid`/`paid_date` carry over so a pre-paid QB job doesn't nag
 *     for payment.
 *   - `due_date` comes from the operator, never from invoice.due —
 *     QB's DueDate is a PAYMENT due date, not a press date.
 *
 * @param {object} invoice   the imported invoice row
 * @param {object} opts
 * @param {string} opts.userEmail   shop scope (becomes shop_owner)
 * @param {object} [opts.customer]  matched customer row (for company/email)
 * @param {string} [opts.dueDate]   production due date (YYYY-MM-DD) or null
 * @param {string} [opts.status]    starting production status
 * @param {number} [opts.now]       injected clock for deterministic order_id
 * @param {string} [opts.today]     shop-tz YYYY-MM-DD for order_date
 * @returns {object} payload ready for Order.create()
 */
export function buildOrderFromInvoice(
  invoice,
  { userEmail = "", customer = null, dueDate = null, status = "Art Approval", now = Date.now(), today } = {},
) {
  const inv = invoice || {};
  const orderDate = today || new Date(now).toISOString().split("T")[0];

  return {
    order_id: generateOrderId(now),
    quote_id: "",
    shop_owner: userEmail,
    broker_id: inv.broker_id || "",
    broker_name: inv.broker_name || "",
    broker_company: "",
    broker_client_name: "",
    customer_id: inv.customer_id ?? customer?.id ?? null,
    customer_name: inv.customer_name || customer?.name || "Unknown",
    company: customer?.company || "",
    customer_email: customer?.email || "",
    job_title: "",
    date: inv.date || orderDate,
    order_date: orderDate,
    due_date: dueDate || null,
    status,
    line_items: Array.isArray(inv.line_items) ? inv.line_items : [],
    notes: inv.notes || "",
    rush_rate: Number(inv.rush_rate) || 0,
    extras: inv.extras || {},
    discount: Number(inv.discount) || 0,
    discount_type: inv.discount_type || "percent",
    discount_description: inv.discount_description || null,
    setup_total: Number(inv.setup_total) || 0,
    additional_charges: inv.additional_charges ?? null,
    deposit_pct: inv.deposit_pct ?? null,
    deposit_paid: Boolean(inv.deposit_paid),
    tax_rate: Number(inv.tax_rate) || 0,
    subtotal: Number(inv.subtotal) || 0,
    tax: Number(inv.tax) || 0,
    total: Number(inv.total) || 0,
    paid: Boolean(inv.paid),
    paid_date: inv.paid ? (inv.paid_date || orderDate) : null,
    selected_artwork: [],
  };
}
