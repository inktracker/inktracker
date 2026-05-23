// Fire a broker-bound BrokerNotification when the shop performs an action
// on a broker-originated quote/order. Mirror of the broker→shop flow that
// already lives in handleSaveQuote (BrokerDashboard).
//
// Why a shared helper:
//   - Multiple shop-side handlers (approve / decline / complete) need to
//     fire this; keeping the payload shape consistent in one place stops
//     them from drifting.
//   - The same RLS policy on broker_notifications lets both shop_owner
//     and broker_id read these rows (see 20260501_rls_lockdown.sql).
//     So setting broker_id = broker's email + shop_owner = shop's email
//     lets BOTH sides see the row — the broker filters by broker_id for
//     their inbox, the shop continues to filter by shop_owner.
//
// Best-effort: failures are logged and swallowed. The actual status change
// has already landed in the DB by the time this runs; failing to notify
// shouldn't roll that back.

import { base44 } from "@/api/supabaseClient";

const ACTION_LABELS = {
  shop_approved_quote: "approved your quote",
  shop_declined_quote: "declined your quote",
  shop_completed_order: "completed your order",
};

export async function notifyBrokerOfShopAction({ quote, action, shopEmail }) {
  if (!quote) return;
  const brokerId = quote.broker_id || quote.broker_email;
  if (!brokerId) return; // not a broker quote — nothing to fire

  if (!ACTION_LABELS[action]) {
    console.warn("[notifyBrokerOfShopAction] unknown action:", action);
    return;
  }

  try {
    await base44.entities.BrokerNotification.create({
      // shop_owner stays on the row so the shop side can still see it in
      // their own feed (audit / "did I do that?"). broker_id is the
      // recipient pointer the broker dashboard filters by.
      shop_owner: shopEmail || quote.shop_owner || "",
      broker_id: brokerId,
      broker_name: quote.broker_name || "",
      broker_company: quote.broker_company || "",
      action,
      item_label: `${quote.quote_id || "Quote"} — ${quote.customer_name || "Unknown client"}`,
      item_id: quote.id,
      item_entity: "Quote",
      read: false,
    });
  } catch (err) {
    console.warn("[notifyBrokerOfShopAction] create failed:", err);
  }
}
