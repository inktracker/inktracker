// Pure logic for the QB webhook handler. Extracted so the cross-tenant
// scoping, idempotency rules, and payload parsing are unit-testable
// without spinning up a Deno runtime or a real Supabase client.
//
// Imported by ../qbWebhook/index.ts. Keep this file dependency-free
// so it loads from both Deno (.ts edge function) and Node (vitest).

// ── Quote lookup ─────────────────────────────────────────────────────────────

/**
 * Build the Supabase query that finds the InkTracker quote corresponding
 * to a paid QB invoice. Always scoped by BOTH the QB invoice id and the
 * shop owner — never by qb_invoice_id alone.
 *
 * Why: QB invoice ids are realm-scoped, not globally unique. Two
 * different shops' QB companies can independently issue an invoice id
 * of e.g. "1042". The webhook runs under the service-role key (which
 * bypasses RLS), so a query on qb_invoice_id alone would non-
 * deterministically match whichever shop's quote was stored first —
 * silently converting the wrong shop's quote to an order.
 *
 * Returns the query builder (already configured) — caller awaits it.
 *
 * @param {object} supabase  service-role Supabase client
 * @param {string} qbInvoiceId  the QB invoice id from the webhook payload
 * @param {string} shopOwner  the shop_owner email, looked up from the
 *                            profile that owns the realmId
 */
export function buildPaidInvoiceQuery(supabase, qbInvoiceId, shopOwner) {
  if (!qbInvoiceId) throw new Error("buildPaidInvoiceQuery: qbInvoiceId required");
  if (!shopOwner)   throw new Error("buildPaidInvoiceQuery: shopOwner required");
  return supabase
    .from("quotes")
    .select("*")
    .eq("qb_invoice_id", qbInvoiceId)
    .eq("shop_owner", shopOwner)
    .maybeSingle();
}

/**
 * Same tenant-scoping rule as buildPaidInvoiceQuery, but searches the
 * invoices table. Used as a SECOND-pass lookup when the quote table
 * doesn't carry the qb_invoice_id — happens on orders completed without
 * the quote-side Send flow (an invoice was created via runOrderCompletion
 * and pushed to QB independently). Required for the order-already-exists
 * payment path to flow.
 */
export function buildPaidInvoiceQueryFromInvoices(supabase, qbInvoiceId, shopOwner) {
  if (!qbInvoiceId) throw new Error("buildPaidInvoiceQueryFromInvoices: qbInvoiceId required");
  if (!shopOwner)   throw new Error("buildPaidInvoiceQueryFromInvoices: shopOwner required");
  return supabase
    .from("invoices")
    .select("*")
    .eq("qb_invoice_id", qbInvoiceId)
    .eq("shop_owner", shopOwner)
    .maybeSingle();
}

// ── Idempotency / conversion decision ────────────────────────────────────────

export const PAID_INVOICE_ACTIONS = Object.freeze({
  CONVERT:                 "convert",
  MARK_LINKED_PAID:        "mark-linked-paid",
  SKIP_NOT_FOUND:          "skip-not-found",
  SKIP_ALREADY_CONVERTED:  "skip-already-converted",
  SKIP_INVALID_QUOTE:      "skip-invalid-quote",
});

/**
 * Decide what to do with a quote returned from buildPaidInvoiceQuery.
 *
 * - `null` quote → skip-not-found (caller should fall back to invoice-side lookup)
 * - missing required fields (id, shop_owner) → skip-invalid-quote
 *   (defensive guard against partial rows from manual DB edits)
 * - quote already converted AND already paid → skip-already-converted
 *   (true no-op: webhook may fire more than once for the same payment)
 * - quote already converted but NOT yet paid → mark-linked-paid
 *   (operator approved + converted manually before payment; the payment
 *   is new news and needs to cascade to the linked order + invoice)
 * - otherwise → convert (the original first-payment path)
 */
export function decidePaidInvoiceAction(quote) {
  if (!quote) {
    return { action: PAID_INVOICE_ACTIONS.SKIP_NOT_FOUND, reason: "no quote matched" };
  }
  if (!quote.id || !quote.shop_owner) {
    return {
      action: PAID_INVOICE_ACTIONS.SKIP_INVALID_QUOTE,
      reason: "quote row missing id or shop_owner",
    };
  }
  const isConverted = quote.status === "Converted to Order" || Boolean(quote.converted_order_id);
  if (isConverted) {
    if (quote.paid) {
      return {
        action: PAID_INVOICE_ACTIONS.SKIP_ALREADY_CONVERTED,
        reason: `quote ${quote.quote_id ?? quote.id} already converted and paid`,
      };
    }
    return {
      action: PAID_INVOICE_ACTIONS.MARK_LINKED_PAID,
      reason: `quote ${quote.quote_id ?? quote.id} converted but unpaid — cascade mark paid`,
    };
  }
  return { action: PAID_INVOICE_ACTIONS.CONVERT, reason: "active quote, convert to order" };
}

// ── Cascade: mark quote → order → invoice paid ──────────────────────────────
// Used by both the webhook and the reconcile cron when a payment lands
// for an already-converted quote. Idempotent at every step: each row's
// update is gated on (paid = false) so a re-run is a no-op. Returns
// a summary so the caller can decide whether to send a notification
// (skip when nothing was newly flipped).

/**
 * Mark the quote paid + walk to its linked order + linked invoice and
 * mark those paid too. Cross-tenant safe: every UPDATE carries the
 * shop_owner filter even though the row id alone would suffice — defense
 * in depth, same pattern as buildPaidInvoiceQuery.
 *
 * @param {object} supabase   service-role client
 * @param {object} quote      the quote row (must have id, shop_owner, converted_order_id)
 * @param {string} today      ISO date (YYYY-MM-DD) to stamp on paid_date
 *
 * @returns {{
 *   quoteUpdated: boolean,
 *   orderUpdated: boolean,
 *   invoiceUpdated: boolean,
 * }}
 */
export async function cascadeMarkLinkedPaid(supabase, quote, today) {
  if (!supabase) throw new Error("cascadeMarkLinkedPaid: supabase required");
  if (!quote?.id || !quote?.shop_owner) {
    throw new Error("cascadeMarkLinkedPaid: quote.id + shop_owner required");
  }
  if (!today) throw new Error("cascadeMarkLinkedPaid: today (YYYY-MM-DD) required");

  const updates = { quoteUpdated: false, orderUpdated: false, invoiceUpdated: false };

  // 1. Quote — only if not already paid. eq("paid", false) is an extra
  // guard against the race where two webhook deliveries land at once.
  if (!quote.paid) {
    const { error: qErr } = await supabase
      .from("quotes")
      .update({ paid: true, paid_date: today })
      .eq("id", quote.id)
      .eq("shop_owner", quote.shop_owner)
      .eq("paid", false);
    if (!qErr) updates.quoteUpdated = true;
  }

  // 2. Linked order via converted_order_id (a human ORD-XXX string).
  // Skip if the quote was converted via some legacy path that didn't
  // stamp converted_order_id — there's nothing to walk to.
  if (!quote.converted_order_id) return updates;

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_id, paid")
    .eq("order_id", quote.converted_order_id)
    .eq("shop_owner", quote.shop_owner)
    .maybeSingle();
  if (!order) return updates;

  if (!order.paid) {
    const { error: oErr } = await supabase
      .from("orders")
      .update({ paid: true, paid_date: today })
      .eq("id", order.id)
      .eq("shop_owner", quote.shop_owner)
      .eq("paid", false);
    if (!oErr) updates.orderUpdated = true;
  }

  // 3. Linked invoice via the order's order_id. Older orders may not
  // have an invoice row yet (invoice creation is part of completion);
  // that's fine — nothing to update.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, paid")
    .eq("order_id", order.order_id)
    .eq("shop_owner", quote.shop_owner)
    .maybeSingle();
  if (!invoice) return updates;

  if (!invoice.paid) {
    const { error: iErr } = await supabase
      .from("invoices")
      .update({ paid: true, paid_date: today })
      .eq("id", invoice.id)
      .eq("shop_owner", quote.shop_owner)
      .eq("paid", false);
    if (!iErr) updates.invoiceUpdated = true;
  }

  return updates;
}

/**
 * Mirror of cascadeMarkLinkedPaid but starting from an invoice row
 * (the "no matching quote" path — invoice was created from order
 * completion without going through Send Quote). Walks invoice →
 * linked order via order_id. There's no quote to mark.
 *
 * @returns {{ invoiceUpdated: boolean, orderUpdated: boolean }}
 */
export async function cascadeMarkInvoicePaid(supabase, invoice, today) {
  if (!supabase) throw new Error("cascadeMarkInvoicePaid: supabase required");
  if (!invoice?.id || !invoice?.shop_owner) {
    throw new Error("cascadeMarkInvoicePaid: invoice.id + shop_owner required");
  }
  if (!today) throw new Error("cascadeMarkInvoicePaid: today (YYYY-MM-DD) required");

  const updates = { invoiceUpdated: false, orderUpdated: false };

  if (!invoice.paid) {
    const { error: iErr } = await supabase
      .from("invoices")
      .update({ paid: true, paid_date: today })
      .eq("id", invoice.id)
      .eq("shop_owner", invoice.shop_owner)
      .eq("paid", false);
    if (!iErr) updates.invoiceUpdated = true;
  }

  if (!invoice.order_id) return updates;

  const { data: order } = await supabase
    .from("orders")
    .select("id, paid")
    .eq("order_id", invoice.order_id)
    .eq("shop_owner", invoice.shop_owner)
    .maybeSingle();
  if (!order) return updates;

  if (!order.paid) {
    const { error: oErr } = await supabase
      .from("orders")
      .update({ paid: true, paid_date: today })
      .eq("id", order.id)
      .eq("shop_owner", invoice.shop_owner)
      .eq("paid", false);
    if (!oErr) updates.orderUpdated = true;
  }

  return updates;
}

// ── Build the order insert row from a quote ──────────────────────────────────

/**
 * Build the row that gets inserted into `orders` when a paid quote is
 * converted. Preserves the quote's shop_owner (NEVER use the calling
 * profile's shop_owner — defense in depth: even if the lookup query
 * was somehow bypassed, the order would still be filed against the
 * quote's true tenant).
 *
 * Tax is zeroed for broker-submitted quotes — brokers' tax handling
 * happens on their side, not in our books.
 */
export function buildOrderInsertFromQuote(quote, orderId) {
  if (!quote)        throw new Error("buildOrderInsertFromQuote: quote required");
  if (!quote.id)     throw new Error("buildOrderInsertFromQuote: quote.id required");
  if (!quote.shop_owner) throw new Error("buildOrderInsertFromQuote: quote.shop_owner required");
  if (!orderId)      throw new Error("buildOrderInsertFromQuote: orderId required");

  const isBroker = Boolean(quote.broker_id || quote.broker_email);

  const subtotal = parseFloat(quote.subtotal ?? 0) || 0;
  const tax      = parseFloat(quote.tax ?? 0) || 0;
  const total    = parseFloat(quote.total ?? 0) || (subtotal + tax);

  return {
    order_id:           orderId,
    shop_owner:         quote.shop_owner,
    broker_id:          quote.broker_id || "",
    broker_name:        quote.broker_name || "",
    broker_company:     quote.broker_company || "",
    customer_id:        quote.customer_id,
    customer_name:      quote.customer_name,
    // Denormalize company so order surfaces render company-first (matches the
    // frontend buildOrderFromQuote). See feedback_company_name_first.
    company:            quote.company || "",
    broker_client_name: isBroker ? (quote.customer_name || "") : "",
    job_title:          quote.job_title || "",
    date:               quote.date,
    due_date:           quote.due_date || null,
    status:             "Art Approval",
    line_items:         quote.line_items,
    notes:              quote.notes,
    rush_rate:          quote.rush_rate,
    extras:             quote.extras,
    discount:           quote.discount,
    discount_type:      quote.discount_type || "percent",
    tax_rate:           isBroker ? 0 : quote.tax_rate,
    subtotal,
    tax,
    total,
    paid:               false,
    selected_artwork:   quote.selected_artwork || [],
  };
}

// ── QB payload parsing ───────────────────────────────────────────────────────

/**
 * Pull every linked invoice id off a QB Payment payload. QB nests them
 * deep: payment.Line[].LinkedTxn[] where TxnType === "Invoice".
 */
export function extractInvoiceIdsFromPayment(payment) {
  const ids = [];
  for (const line of payment?.Line ?? []) {
    for (const linked of line?.LinkedTxn ?? []) {
      if (linked?.TxnType === "Invoice" && linked?.TxnId) {
        ids.push(String(linked.TxnId));
      }
    }
  }
  return ids;
}

/**
 * "Is this QB invoice fully paid?" — TotalAmt > 0 AND Balance === 0.
 * A $0 invoice (draft with no line items, never sent) reads as
 * Balance===0 alone but is NOT a paid invoice — we'd incorrectly
 * convert the source quote to an order on a stray Update webhook.
 * Conservative on every other edge: missing/non-finite Balance, missing
 * TotalAmt, all read as "not paid".
 * Matches isQbInvoicePaid in ../qbInvoice.js — both are the same
 * predicate applied at different surfaces (write path + webhook).
 */
export function isInvoiceFullyPaid(invoice) {
  if (!invoice) return false;
  // Guard against null/undefined Balance — Number(null) is 0, which
  // would otherwise make a missing Balance falsely look fully paid.
  if (invoice.Balance === null || invoice.Balance === undefined) return false;
  const balance = Number(invoice.Balance);
  const total = Number(invoice.TotalAmt ?? 0);
  if (!Number.isFinite(balance) || !Number.isFinite(total)) return false;
  return total > 0 && balance === 0;
}
