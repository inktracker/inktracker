// Side-effect runner for marking an order Completed. Wraps the pure
// buildOrderCompletionPlan in the I/O it needs: invoice creation
// (or linking an existing one), broker + shop performance rows,
// the BrokerFile attachment (only for broker orders with a PDF),
// the order status/date update, and the broker notification.
//
// Lives here so Orders.jsx, Production.jsx, and ShopFloor.jsx can
// all flip an order to Completed without drifting on side effects.
// Pre-extraction, only Orders.jsx had the BrokerFile branch; the
// other two pages were quietly skipping it. The extraction also
// closed that gap.
//
// Returns the updated order row. Throws if any I/O step fails so
// the caller can surface the error and refuse to mark the row
// complete in local state.

import { buildOrderCompletionPlan } from "./completeOrder";
import { todayInShopTz } from "@/lib/shopTimezone";
import { notifyBrokerOfShopAction } from "@/lib/broker/notifyBrokerOfShopAction";
import { shopScope } from "@/lib/shopScope";

// Takes the whole `user` object (not an email) and derives the tenant
// key itself: when a manager or employee completes an order, the
// invoice/performance rows must land under the OWNER's email
// (user.shop_owner), never the team member's own — otherwise they're
// invisible to the shop and the modal offers to create a duplicate.
export async function runOrderCompletion({ order, user, base44 }) {
  if (!order) throw new Error("runOrderCompletion: order required");
  const shopOwner = shopScope(user);
  if (!shopOwner) throw new Error("runOrderCompletion: user with a resolvable shop required");

  const today = todayInShopTz();

  // Three-way existing-invoice lookup. Without this we'd create a
  // duplicate invoice row whenever the Send-Quote path had already
  // pushed one to QB (the bug Joe hit 2026-05-12 with Shana K).
  let existingInvoice = null;
  try {
    const byOrderId = await base44.entities.Invoice.filter({
      shop_owner: shopOwner,
      order_id: order.order_id,
    });
    if (byOrderId.length > 0) {
      existingInvoice = byOrderId[0];
    } else if (order.quote_id) {
      const byQuoteId = await base44.entities.Invoice.filter({
        shop_owner: shopOwner,
        invoice_id: order.quote_id,
      });
      if (byQuoteId.length > 0) existingInvoice = byQuoteId[0];
    }
    // Third fallback: orders converted before PR#45 lack order.quote_id.
    // Walk Quote.converted_order_id → quote_id to recover the link.
    if (!existingInvoice) {
      const originatingQuotes = await base44.entities.Quote.filter({
        shop_owner: shopOwner,
        converted_order_id: order.order_id,
      });
      const qId = originatingQuotes?.[0]?.quote_id;
      if (qId) {
        const byReversedQuoteId = await base44.entities.Invoice.filter({
          shop_owner: shopOwner,
          invoice_id: qId,
        });
        if (byReversedQuoteId.length > 0) existingInvoice = byReversedQuoteId[0];
      }
    }
  } catch (err) {
    console.error("[runOrderCompletion] failed to look up existing invoice:", err);
    // Continue without — the DB unique index from
    // 20260519_invoices_no_duplicates.sql refuses a duplicate insert
    // as the last-line backstop.
  }

  const plan = buildOrderCompletionPlan(order, {
    today,
    shopOwner,
    existingInvoice,
  });

  if (plan.invoiceLink) {
    await base44.entities.Invoice.update(plan.invoiceLink.id, plan.invoiceLink.patch);
  } else if (plan.invoiceCreate) {
    await base44.entities.Invoice.create(plan.invoiceCreate);
  }

  if (plan.brokerPerformanceCreate) {
    await base44.entities.BrokerPerformance.create(plan.brokerPerformanceCreate);
    // BrokerFile attachment — only fires when the order has a pdf_url.
    // Independent of the invoice path. Surfaces the order PDF in the
    // broker's "Files" feed so they can hand it to their end client.
    if (order.pdf_url) {
      await base44.entities.BrokerFile.create({
        broker_id: order.broker_id,
        shop_owner: shopOwner,
        order_id: order.order_id,
        customer_name: order.customer_name,
        file_url: order.pdf_url,
        date: today,
      });
    }
  }
  await base44.entities.ShopPerformance.create(plan.shopPerformanceCreate);
  const updated = await base44.entities.Order.update(plan.orderUpdate.id, plan.orderUpdate.patch);

  // Notify the broker (no-op for non-broker orders). Best-effort —
  // the helper swallows its own errors, so a Resend hiccup here can't
  // prevent the completion from landing.
  notifyBrokerOfShopAction({
    quote: { ...updated, quote_id: updated.order_id || updated.quote_id },
    action: "shop_completed_order",
    shopEmail: shopOwner,
  });

  return updated;
}
