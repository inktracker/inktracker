// Push delivery for the notifications table.
//
// Called by a pg_net trigger (AFTER INSERT ON public.notifications,
// migration 20261009000000) with { record: { id } }. Fans the new
// notification out to every live push subscription for that shop.
//
// Endpoint hardening — same posture as notifySignup: verify_jwt=false
// (pg_net can't attach a user JWT), so this function is SELF-VALIDATING
// rather than trusting its input. It re-reads the notification row
// server-side and refuses anything that isn't a real, recent row. A
// spammed endpoint can therefore only re-deliver notifications the shop
// was already getting — it can't be used to push arbitrary text to a
// shop owner's lock screen, which is the attack that matters here.
//
// Delivery is best-effort by design: a push that fails must never be
// retried into a loop, and must never affect the notification row the
// user sees in the bell. The bell is the source of truth; push is a tap
// on the shoulder.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { buildPushRequest, isGoneStatus } from "../_shared/webPush.js";
import { buildPushPayload, urgencyFor, isFreshEnough } from "../_shared/pushPayload.js";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
// RFC 8292 requires a contact the push service can reach about abuse.
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:joe@biotamfg.co";

// Only deliver notifications created in the last few minutes. A replayed
// or forged id for an OLD row then does nothing, and a backfill that
// inserts historical rows can't carpet-bomb someone's phone.
const MAX_AGE_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    // Loud, because a silently unconfigured key means no shop ever gets a
    // push and nothing else in the system notices.
    console.error("[sendPush] VAPID keys not configured — refusing to run.");
    return Response.json({ error: "push not configured" }, { status: 503 });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const notificationId = payload?.record?.id;
    if (notificationId === undefined || notificationId === null) {
      return Response.json({ error: "record.id required" }, { status: 400 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: note, error: noteErr } = await admin
      .from("notifications")
      .select("id, shop_owner, event_type, severity, title, body, related_entity, related_id, created_at")
      .eq("id", notificationId)
      .maybeSingle();

    if (noteErr) throw noteErr;
    if (!note) {
      // Not an error worth alarming on — a deleted row or a bogus id.
      return Response.json({ ok: true, skipped: "no such notification" });
    }
    if (!isFreshEnough(note.created_at, Date.now(), MAX_AGE_MS)) {
      return Response.json({ ok: true, skipped: "notification too old" });
    }

    const { data: subs, error: subErr } = await admin
      .from("push_subscriptions")
      .select("id, platform, endpoint, p256dh, auth_secret")
      .eq("shop_owner", note.shop_owner)
      .eq("platform", "web")
      .is("disabled_at", null);

    if (subErr) throw subErr;
    if (!subs?.length) {
      return Response.json({ ok: true, sent: 0, reason: "no subscriptions" });
    }

    // The notification body can contain customer names and dollar amounts.
    // That's the point — but it means the payload is only ever sent
    // encrypted (RFC 8291), never in a header or query string.
    const body = buildPushPayload(note);

    const vapid = { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE, subject: VAPID_SUBJECT };

    const results = await Promise.all(subs.map(async (sub) => {
      try {
        const request = await buildPushRequest({
          subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth_secret },
          payload: body,
          vapid,
          urgency: urgencyFor(note.severity),
        });
        const res = await fetch(request.url, {
          method: "POST", headers: request.headers, body: request.body,
        });
        return { id: sub.id, status: res.status, ok: res.ok };
      } catch (e) {
        // A malformed stored subscription must not take down the fan-out
        // for the shop's other devices.
        console.error(`[sendPush] sub ${sub.id} threw:`, e instanceof Error ? e.message : e);
        return { id: sub.id, status: 0, ok: false };
      }
    }));

    const gone = results.filter((r) => isGoneStatus(r.status)).map((r) => r.id);
    const delivered = results.filter((r) => r.ok).map((r) => r.id);

    // Retire endpoints the push service says are permanently dead. Only
    // 404/410 — a 429 or a 500 is the service having a bad day, and
    // deleting a live device over that is unrecoverable without the user
    // noticing and re-enabling.
    if (gone.length) {
      await admin
        .from("push_subscriptions")
        .update({ disabled_at: new Date().toISOString() })
        .in("id", gone);
    }
    if (delivered.length) {
      await admin
        .from("push_subscriptions")
        .update({ last_sent_at: new Date().toISOString(), failure_count: 0 })
        .in("id", delivered);
    }

    console.log(`[sendPush] note ${note.id} → ${delivered.length}/${results.length} delivered, ${gone.length} retired`);
    return Response.json({ ok: true, sent: delivered.length, total: results.length, retired: gone.length });
  } catch (e) {
    console.error("[sendPush] failed:", e instanceof Error ? e.message : e);
    // 200 on purpose: pg_net has no useful retry semantics here and a
    // failed push must never look like a failed notification insert.
    return Response.json({ ok: false, error: "send failed" });
  }
});
