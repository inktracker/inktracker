// Deleting an order NEVER loses the work: the originating quote was only marked
// "Converted to Order" at conversion (never deleted), so deleting the order
// restores that quote to a visible, re-convertible state.
//
//   - Regular (shop) order → the quote returns to the shop's Quotes list as
//     "Approved" (converted_order_id cleared). Without this it stayed stranded
//     at "Converted to Order", which the Quotes page filters out — so a deleted
//     order silently vanished with no way back.
//   - Broker order → hand the quote back to the broker: "Client Approved",
//     shop_owner cleared (un-queues it from the shop), plus a BrokerNotification
//     so it surfaces in their ShopActionFeed.
//   - Order not created from a quote → nothing to restore.
//
// Best-effort: any sub-step failure is logged and swallowed. The order is
// already deleted by the time this runs; a failed restore shouldn't surprise
// the shop with an error, but the copy in the delete confirm should stay honest
// about what happens.
//
// Callers: shop-side handleDelete in Orders.jsx + Production.jsx.

import { base44 } from "@/api/supabaseClient";

export async function revertQuoteOnOrderDelete(order) {
  if (!order?.order_id) return;

  const brokerId = order.broker_id || order.broker_email;

  // Resolve the source quote (marked converted_order_id at conversion time).
  let sourceQuote = null;
  try {
    const matches = await base44.entities.Quote.filter({ converted_order_id: order.order_id });
    sourceQuote = matches?.[0] || null;
  } catch (err) {
    console.warn("[revertQuoteOnOrderDelete] source-quote lookup failed:", err);
  }

  // Restore the quote when we found one. A direct order (no originating quote)
  // just gets deleted — nothing to restore.
  if (sourceQuote) {
    try {
      await base44.entities.Quote.update(sourceQuote.id, brokerId
        ? { status: "Client Approved", converted_order_id: null, shop_owner: null } // hand back to broker
        : { status: "Approved", converted_order_id: null });                        // back to shop's Quotes
    } catch (err) {
      console.warn("[revertQuoteOnOrderDelete] quote restore failed:", err);
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
}
