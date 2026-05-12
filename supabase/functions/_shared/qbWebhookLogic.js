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

// ── Idempotency / conversion decision ────────────────────────────────────────

export const PAID_INVOICE_ACTIONS = Object.freeze({
  CONVERT:                 "convert",
  SKIP_NOT_FOUND:          "skip-not-found",
  SKIP_ALREADY_CONVERTED:  "skip-already-converted",
  SKIP_INVALID_QUOTE:      "skip-invalid-quote",
});

/**
 * Decide what to do with a quote returned from buildPaidInvoiceQuery.
 *
 * - `null` quote → skip-not-found (lookup failed or returned nothing)
 * - quote with status === "Converted to Order" or converted_order_id
 *   set → skip-already-converted (idempotent — webhook may fire more
 *   than once for the same payment)
 * - missing required fields (id, shop_owner) → skip-invalid-quote
 *   (defensive guard against partial rows from manual DB edits)
 * - otherwise → convert
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
  if (quote.status === "Converted to Order" || quote.converted_order_id) {
    return {
      action: PAID_INVOICE_ACTIONS.SKIP_ALREADY_CONVERTED,
      reason: `quote ${quote.quote_id ?? quote.id} already converted`,
    };
  }
  return { action: PAID_INVOICE_ACTIONS.CONVERT, reason: "active quote, convert to order" };
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
 * "Is this QB invoice fully paid?" — Balance === 0 means no remaining
 * amount due. We treat a missing Balance as "not paid" (conservative
 * — better to skip a webhook than to convert a quote prematurely).
 */
export function isInvoiceFullyPaid(invoice) {
  if (!invoice) return false;
  // Guard against null/undefined Balance — Number(null) is 0, which
  // would otherwise make a missing Balance falsely look fully paid.
  if (invoice.Balance === null || invoice.Balance === undefined) return false;
  const balance = Number(invoice.Balance);
  if (!Number.isFinite(balance)) return false;
  return balance === 0;
}
