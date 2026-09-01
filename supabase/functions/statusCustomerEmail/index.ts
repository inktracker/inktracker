// Customer status-update emails, fired by the order_status_customer_notify
// trigger (pg_net, async). SELF-VALIDATING — same posture as sendPush:
// verify_jwt=false because pg_net can't attach a JWT, so nothing in the
// request body is trusted. The order is re-read server-side; the shop's
// opt-in config decides everything; a spammed endpoint can at worst
// re-evaluate a real order, and the 24h dedup makes even that a no-op.
//
// All skips and sends land in notification_log (event 'status_update'),
// which the nightly email-health alert already watches.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  decideStatusEmail,
  buildStatusEmailSubject,
  buildStatusEmailHtml,
} from "../_shared/statusCustomerEmail.js";
import {
  sendApprovalNotification,
  logNotificationAttempt,
} from "../_shared/approvalNotificationEmail.js";

const PUBLIC_URL = "https://www.inktracker.app";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }
  try {
    const payload = await req.json().catch(() => ({}));
    const orderRowId = payload?.record?.id;
    const toStatus = String(payload?.record?.to ?? "");
    if (!orderRowId || !toStatus) {
      return Response.json({ error: "record.id and record.to required" }, { status: 400 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Authoritative re-read — the trigger's claim is only a pointer.
    const { data: order } = await admin
      .from("orders")
      .select("id, order_id, shop_owner, status, customer_name, customer_email, broker_id, public_token")
      .eq("id", orderRowId)
      .maybeSingle();
    if (!order) return Response.json({ ok: true, skipped: "no such order" });
    // Status moved again since the trigger fired — the newer transition's
    // own invocation is the one that should speak.
    if (order.status !== toStatus) {
      return Response.json({ ok: true, skipped: "status moved on" });
    }

    const { data: shop } = await admin
      .from("shops")
      .select("shop_name, customer_status_notify")
      .eq("owner_email", order.shop_owner)
      .maybeSingle();

    const decision = decideStatusEmail({
      order,
      config: shop?.customer_status_notify ?? {},
      toStatus,
    });
    if (!decision.send) {
      // Not-enabled is the overwhelmingly common case — stay quiet in the
      // log for it, record the interesting skips.
      if (decision.reason !== "not_enabled" && decision.reason !== "status_not_customer_facing") {
        await logNotificationAttempt(admin, {
          shop_owner: order.shop_owner,
          event_type: "status_update",
          recipient_email: String(order.customer_email ?? ""),
          recipient_role: "customer",
          order_id: order.id,
          status: "skipped",
          failure_reason: decision.reason,
        });
      }
      return Response.json({ ok: true, skipped: decision.reason });
    }

    // Dedup: one email per (order, status) per 24h — status flapping on
    // the floor must not carpet-bomb a customer.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("notification_log")
      .select("id, subject")
      .eq("event_type", "status_update")
      .eq("order_id", order.id)
      .eq("status", "sent")
      .gte("created_at", dayAgo)
      .limit(10);
    const subject = buildStatusEmailSubject({
      shopName: shop?.shop_name ?? "",
      orderId: order.order_id,
      subjectBit: decision.subjectBit,
    });
    if ((recent ?? []).some((r) => r.subject === subject)) {
      return Response.json({ ok: true, skipped: "already sent recently" });
    }

    const html = buildStatusEmailHtml({
      shopName: shop?.shop_name ?? "",
      customerName: order.customer_name,
      orderId: order.order_id,
      phrase: decision.phrase,
      note: decision.note,
      statusUrl: order.public_token
        ? `${PUBLIC_URL}/OrderStatus?id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.public_token)}`
        : "",
    });

    const result = await sendApprovalNotification({
      to: order.customer_email,
      subject,
      html,
      reply_to: order.shop_owner,
    });

    await logNotificationAttempt(admin, {
      shop_owner: order.shop_owner,
      event_type: "status_update",
      recipient_email: order.customer_email,
      recipient_role: "customer",
      order_id: order.id,
      subject,
      status: result.ok ? "sent" : "failed",
      failure_reason: result.ok ? null : (result.reason || "send_failed"),
      resend_id: result.ok ? (result.id ?? null) : null,
    });

    return Response.json({ ok: result.ok, sent: result.ok });
  } catch (e) {
    console.error("[statusCustomerEmail]", e instanceof Error ? e.message : e);
    return Response.json({ error: "internal" }, { status: 500 });
  }
});
