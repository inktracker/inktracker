// Shared writer for the in-app notification bell — the `notifications` table
// read by src/components/NotificationBell.jsx. Edge functions run under the
// service role, which is the ONLY role allowed to INSERT here (see migration
// 20260512_notifications.sql; authenticated users can read/update their own
// but never forge a row).
//
// Best-effort by contract: emitting a notification must NEVER break the
// payment/conversion flow that calls it. Every failure is swallowed + logged,
// including a mock/test client that doesn't know the table.

export async function insertShopNotification(supabase, {
  shopOwner,
  eventType,
  severity = "info",
  title,
  body = "",
  relatedEntity = null,
  relatedId = null,
  metadata = {},
}) {
  if (!supabase || !shopOwner || !title) return;
  try {
    const { error } = await supabase.from("notifications").insert({
      shop_owner: shopOwner,
      event_type: eventType,
      severity,
      title,
      body,
      related_entity: relatedEntity,
      related_id: relatedId != null ? String(relatedId) : null,
      metadata,
    });
    if (error) console.error("[notifications] insert failed:", error.message);
  } catch (err) {
    console.error("[notifications] insert threw:", err?.message ?? err);
  }
}

export function fmtMoneyShort(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}
