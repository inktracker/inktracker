// When the shop deletes an order that originated from a broker quote, the
// broker is otherwise left looking at a "Converted to Order" status with
// no underlying order — stale, confusing, and silent. This helper:
//
//   1. Looks up the source quote (Quote.converted_order_id === order.order_id)
//   2. Rolls the quote back so the broker can resubmit if appropriate:
//        - status: "Client Approved"  (one step before submission)
//        - converted_order_id: null
//        - shop_owner: null           (un-queues it from the shop's list)
//   3. Fires a BrokerNotification keyed to the broker so it shows up in
//      ShopActionFeed on the broker's dashboard.
//
// Best-effort: any sub-step failure is logged and swallowed. The order is
// already deleted by the time this runs; refusing-to-notify would surprise
// the shop owner without any way to recover.
//
// Callers: shop-side handleDelete in Orders.jsx, Production.jsx, and any
// other place that calls base44.entities.Order.delete on a broker order.

import { base44 } from "@/api/supabaseClient";

export async function handleBrokerOrderDeletion(order) {
  if (!order) return;
  const brokerId = order.broker_id || order.broker_email;
  if (!brokerId) return; // not a broker order — nothing to do

  // 1. Roll back the source quote.
  let sourceQuote = null;
  try {
    if (order.order_id) {
      const matches = await base44.entities.Quote.filter({
        converted_order_id: order.order_id,
      });
      sourceQuote = matches?.[0] || null;
    }
    if (sourceQuote) {
      await base44.entities.Quote.update(sourceQuote.id, {
        status: "Client Approved",
        converted_order_id: null,
        shop_owner: null,
      });
    }
  } catch (err) {
    console.warn("[handleBrokerOrderDeletion] quote rollback failed:", err);
  }

  // 2. Notify the broker via the BrokerNotification row that
  //    ShopActionFeed already watches (broker_id-keyed).
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
    console.warn("[handleBrokerOrderDeletion] notification create failed:", err);
  }
}
