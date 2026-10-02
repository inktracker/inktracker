// Deleting an order NEVER loses the work: the originating quote was only marked
// "Converted to Order" at conversion (never deleted), so deleting the order
// restores that quote to a visible, re-convertible state.
//
//   - Regular (shop) order → the quote returns to the shop's Quotes list as
//     "Approved" (converted_order_id cleared). Without this it stayed stranded
//     at "Converted to Order", which the Quotes page filters out — so a deleted
//     order silently vanished with no way back.
//   - Broker order → hand the quote back to the broker: "Client Approved",
//     re-tenanted to `broker:<email>` (un-queues it from the shop), plus a
//     BrokerNotification so it surfaces in their ShopActionFeed. Goes through
//     the return_quote_to_broker RPC: the shop's own RLS can't move a row out
//     of its tenant, and shop_owner is NOT NULL — the old direct update
//     (shop_owner: null) always failed silently and stranded the quote.
//   - Order not created from a quote → nothing to restore.
//
// Fail-open but NOT silent: the order is already deleted by the time this
// runs, so a failed restore never blocks the delete — but it MUST be reported.
// The old fire-and-forget version returned undefined either way while the
// delete confirm promised "nothing is lost"; on a failed restore the quote
// kept converted_order_id, the Quotes page filtered it out forever, and
// handleConvert refused it — the whole job silently vanished (audit,
// 2026-10-02). Returns { ok, restored, quoteId?, error? } so callers can tell
// the operator exactly which quote to rescue. The broker NOTIFICATION remains
// best-effort (the restore is the artifact; the bell is a bonus).
//
// Callers: shop-side handleDelete in Orders.jsx + Production.jsx (both await
// this and notify on ok:false).

import { base44, supabase } from "@/api/supabaseClient";

export async function revertQuoteOnOrderDelete(order) {
  if (!order?.order_id) return { ok: true, restored: false };

  const brokerId = order.broker_id || order.broker_email;

  // Resolve the source quote (marked converted_order_id at conversion time).
  let sourceQuote = null;
  try {
    const matches = await base44.entities.Quote.filter({ converted_order_id: order.order_id });
    sourceQuote = matches?.[0] || null;
  } catch (err) {
    console.warn("[revertQuoteOnOrderDelete] source-quote lookup failed:", err);
    // Can't tell whether a quote exists — report so the operator can check.
    return { ok: false, restored: false, error: err?.message || String(err) };
  }

  // Restore the quote when we found one. A direct order (no originating quote)
  // just gets deleted — nothing to restore.
  if (sourceQuote) {
    try {
      if (brokerId) {
        // Hand back to broker (server-side; see header).
        const { error } = await supabase.rpc("return_quote_to_broker", { p_quote_id: String(sourceQuote.id) });
        if (error) throw error;
      } else {
        // Back to the shop's Quotes list.
        await base44.entities.Quote.update(sourceQuote.id, { status: "Approved", converted_order_id: null });
      }
    } catch (err) {
      console.warn("[revertQuoteOnOrderDelete] quote restore failed:", err);
      return {
        ok: false,
        restored: false,
        quoteId: sourceQuote.quote_id || sourceQuote.id,
        error: err?.message || String(err),
      };
    }
  }

  // Broker-only: notify the broker via the BrokerNotification row that
  // ShopActionFeed watches (broker_id-keyed).
  if (brokerId) {
    try {
      await base44.entities.BrokerNotification.create({
        shop_owner: order.shop_owner || "",
        broker_id: brokerId,
        broker_name: order.broker_name || sourceQuote?.broker_name || "",
        broker_company: order.broker_company || sourceQuote?.broker_company || "",
        action: "shop_deleted_order",
        item_label: `${order.order_id || sourceQuote?.quote_id || "Order"} — ${
          order.customer_name || sourceQuote?.customer_name || "Unknown client"
        }`,
        item_id: sourceQuote?.id || null,
        item_entity: sourceQuote ? "Quote" : "Order",
        read: false,
      });
    } catch (err) {
      console.warn("[revertQuoteOnOrderDelete] broker notification failed:", err);
    }
  }

  return { ok: true, restored: !!sourceQuote, quoteId: sourceQuote?.quote_id || sourceQuote?.id || null };
}
