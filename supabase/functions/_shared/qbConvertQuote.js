// Shared quote→order conversion. Used by both qbWebhook (when a Payment
// Create or Invoice Update with Balance=0 lands) and qbSync.refreshInvoice
// (when an operator hits "Refresh from QB" and we discover the invoice
// was paid since the last sync — i.e. a missed webhook).
//
// The previous home was qbWebhook/index.ts. Extracted here so the two
// call sites converge on the same DB writes — divergent copies would
// drift on order-row schema changes and we'd have two subtly different
// conversion paths to debug.
//
// Tenant-scoping: every UPDATE filters by BOTH id AND shop_owner. The
// service-role client otherwise updates across tenants on row-id
// collisions. Defense in depth — webhook + refresh both run under
// service role.

import { buildOrderInsertFromQuote } from "./qbWebhookLogic.js";
import { makeOrderId } from "./qbInvoice.js";
import { insertShopNotification, fmtMoneyShort } from "./notifications.js";

/**
 * Insert an `orders` row from the quote and flip the quote to
 * "Converted to Order". Returns the new order_id, or the existing
 * one if another caller raced us to the conversion.
 *
 * Concurrent-callers contract:
 *   webhook + refreshInvoice + reconcile cron can all fire for the
 *   same quote within milliseconds. We claim conversion FIRST with
 *   an atomic update gated on `converted_order_id IS NULL`. Only
 *   the winning caller proceeds to insert into `orders`. Losers
 *   read the winner's order_id and return that.
 *
 *   Without this, two concurrent callers each passed the "not
 *   converted" decision check, each inserted into `orders`, and
 *   each updated quotes (the second was a no-op). End state: TWO
 *   order rows for one quote — exactly the divergence we hardened
 *   against in PRs A+B but at a different layer.
 *
 * @param {object} supabase  service-role client
 * @param {object} quote     full quote row (must have id + shop_owner)
 * @returns {Promise<string>}  the new order_id (or the existing one
 *                             if another caller won the race)
 */
export async function convertQuoteToOrder(supabase, quote) {
  const orderId  = makeOrderId();
  const nowIso   = new Date().toISOString();

  // Atomic claim. The `is("converted_order_id", null)` filter is what
  // makes this safe under concurrent callers — Postgres serializes,
  // exactly one caller's UPDATE matches a row.
  const { data: claimed, error: claimErr } = await supabase
    .from("quotes")
    .update({
      status:             "Converted to Order",
      converted_order_id: orderId,
      converted_at:       nowIso,
      deposit_paid:       true,
    })
    .eq("id", quote.id)
    .eq("shop_owner", quote.shop_owner)
    .is("converted_order_id", null)
    .select("converted_order_id");

  if (claimErr) throw new Error(`convertQuoteToOrder: claim failed: ${claimErr.message}`);

  // Lost the race — another caller already wrote a different order_id.
  // Read it back and return that so the caller has a usable id.
  if (!claimed || claimed.length === 0) {
    const { data: existing } = await supabase
      .from("quotes")
      .select("converted_order_id")
      .eq("id", quote.id)
      .eq("shop_owner", quote.shop_owner)
      .maybeSingle();
    return existing?.converted_order_id || orderId;
  }

  // We won the claim. Insert the order row now.
  const orderRow = buildOrderInsertFromQuote(quote, orderId);
  await supabase.from("orders").insert(orderRow);

  // Surface it on the shop's notification bell. convertQuoteToOrder is only
  // reached when the quote's invoice has been PAID (QB payment webhook, or a
  // "Refresh from QB" that discovers the payment), so this is the "quote
  // paid → converted" signal. Best-effort: never block the conversion on it.
  // Links by order_id, which the Orders page accepts for ?id= deep-links.
  await insertShopNotification(supabase, {
    shopOwner: quote.shop_owner,
    eventType: "quote_converted",
    severity: "info",
    title: "Payment received — quote converted to order",
    body: `${quote.customer_name || "A customer"} paid quote ${quote.quote_id || ""} (${fmtMoneyShort(quote.total)}). It's now order ${orderId}.`.replace(/\s+/g, " ").trim(),
    relatedEntity: "order",
    relatedId: orderId,
    metadata: { quote_id: quote.quote_id, order_id: orderId },
  });

  return orderId;
}
