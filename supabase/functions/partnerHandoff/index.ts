// Shop partnerships — the ONE cross-tenant bridge
// (docs/shop-partnerships-design.md). Everything that crosses shops in a
// partnership goes through here under the service role, after an
// acts-for-shop check on the caller. Blind-mode sanitization lives in
// _shared/partnerSpec.js (pure, tested); status mirroring is a DB
// trigger; billing rides the normal customer/invoice rails.
//
// Actions:
//   invite        { partnerEmail, specialty }        → shop_partners row + bell/email
//   respondInvite { partnershipId, accept }          → active/ended + bell
//   offer         { partnerShop, orderId, lineIds?, blind?, note?,
//                   dueDate?, tradeTotal }           → partner_handoffs row + artwork copy + bell/email
//   respond       { handoffId, response: 'accept'|'decline'|'counter',
//                   counterDueDate? }                → on accept: receiver order created, trade total SNAPSHOTTED
//   cancel        { handoffId }                      → sender cancels an un-accepted offer

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";
import { recordShopNotification } from "../_shared/shopNotifications.js";
import { sendResendEmail } from "../_shared/resendClient.js";
import {
  buildPartnerSpec,
  buildReceiverOrderInsert,
  partnerCustomerLabel,
} from "../_shared/partnerSpec.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALERT_FROM_EMAIL = Deno.env.get("ALERT_FROM_EMAIL") || "notifications@info.inktracker.app";

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

// Receiver-side order id — same shape the rest of the app mints.
function newOrderId() {
  const year = new Date().getFullYear();
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  return `ORD-${year}-${suffix}`;
}

async function shopDisplayName(db: any, ownerEmail: string): Promise<string> {
  const { data } = await db.from("profiles").select("shop_name").eq("email", ownerEmail).maybeSingle();
  return data?.shop_name || ownerEmail;
}

async function notifyAndEmail(db: any, { shopOwner, eventType, title, body, relatedEntity, relatedId, metadata }: any) {
  await recordShopNotification(db, {
    shopOwner, eventType, severity: "info", title, body, relatedEntity, relatedId, metadata,
  });
  try {
    await sendResendEmail({
      from: `InkTracker <${ALERT_FROM_EMAIL}>`,
      to: [shopOwner],
      subject: `[InkTracker] ${title}`,
      text: `${body}\n\nOpen InkTracker to respond: https://www.inktracker.app`,
    });
  } catch (e) {
    console.warn("[partnerHandoff] email send failed (bell delivered):", (e as Error)?.message);
  }
}

// Copy imprint artwork into the receiver's tenant (design rule: copy,
// never shared access). Best-effort per object; failures are recorded on
// the spec so the receiver knows art is missing rather than assuming none.
async function copyArtwork(db: any, spec: any, receivingShop: string) {
  const missing: string[] = [];
  for (const line of spec.lines ?? []) {
    for (const imp of line.imprints ?? []) {
      const src = imp.artworkPath || imp.artwork || null;
      if (!src || typeof src !== "string") continue;
      const dest = `partner/${crypto.randomUUID()}_${src.split("/").pop()}`;
      try {
        const { error: copyErr } = await db.storage.from("artwork").copy(src, dest);
        if (copyErr) throw copyErr;
        const { error: mapErr } = await db.from("artwork_objects").insert({
          name: dest, shop_owner: receivingShop, uploader_email: receivingShop,
        });
        if (mapErr) console.warn("[partnerHandoff] artwork_objects mapping failed:", mapErr.message);
        imp.artworkPath = dest;
        delete imp.artwork;
        delete imp.artwork_url;
      } catch (e) {
        console.warn(`[partnerHandoff] artwork copy failed for ${src}:`, (e as Error)?.message);
        missing.push(src.split("/").pop() || src);
        delete imp.artworkPath;
        delete imp.artwork;
        delete imp.artwork_url;
      }
    }
  }
  if (missing.length) {
    spec.note = `${spec.note ? spec.note + "\n" : ""}[${missing.length} artwork file(s) could not be transferred — ask the sending shop to re-share.]`;
  }
  return spec;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const { action, accessToken, ...params } = body;
    if (!accessToken) return json({ error: "accessToken required" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser(accessToken);
    if (userErr || !user) return json({ error: "Invalid access token" }, 401);

    const db = admin();
    const { data: profile } = await db
      .from("profiles")
      .select("email, role, shop_owner, shop_name")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (!profile) return json({ error: "Profile not found" }, 404);
    // Owners and managers act for the shop; employees/brokers don't.
    if (!["shop", "admin", "manager"].includes(profile.role || "")) {
      return json({ error: "Partnership actions require an owner or manager account." }, 403);
    }
    const myShop = String(profile.shop_owner || profile.email || "").toLowerCase();
    if (!myShop) return json({ error: "No shop resolved for this account" }, 403);

    // ── invite ─────────────────────────────────────────────────────────
    if (action === "invite") {
      const partnerEmail = String(params.partnerEmail || "").trim().toLowerCase();
      if (!partnerEmail || partnerEmail === myShop) return json({ error: "Enter your partner shop's owner email." }, 400);
      const { data: partnerProf } = await db
        .from("profiles").select("email, role, shop_name").eq("email", partnerEmail).maybeSingle();
      if (!partnerProf || partnerProf.role !== "shop") {
        // v1: existing shops only — referral flow is a product decision.
        return json({ notFound: true, message: "That email isn't an InkTracker shop yet. Ask them to sign up at inktracker.app first — then invite them here." });
      }
      const { data: existing } = await db
        .from("shop_partners").select("id, status")
        .or(`and(shop_a.eq.${myShop},shop_b.eq.${partnerEmail}),and(shop_a.eq.${partnerEmail},shop_b.eq.${myShop})`)
        .limit(1).maybeSingle();
      if (existing && existing.status !== "ended") {
        return json({ error: existing.status === "active" ? "You're already partners." : "An invite is already pending." }, 400);
      }
      let row;
      if (existing) {
        const { data } = await db.from("shop_partners")
          .update({ status: "invited", shop_a: myShop, shop_b: partnerEmail, specialty_a: params.specialty || null, accepted_at: null })
          .eq("id", existing.id).select().single();
        row = data;
      } else {
        const { data, error } = await db.from("shop_partners")
          .insert({ shop_a: myShop, shop_b: partnerEmail, specialty_a: params.specialty || null })
          .select().single();
        if (error) return json({ error: error.message }, 500);
        row = data;
      }
      const myName = await shopDisplayName(db, myShop);
      await notifyAndEmail(db, {
        shopOwner: partnerEmail,
        eventType: "partner_invite",
        title: `${myName} wants to partner with your shop`,
        body: `${myName} invited you to a shop partnership on InkTracker — send each other production work (printing ↔ embroidery) without leaving the app. Accept from Account → Partners.`,
        relatedEntity: "shop_partner",
        relatedId: String(row.id),
        metadata: { from_shop: myShop },
      });
      return json({ ok: true, partnership: row });
    }

    // ── respondInvite ──────────────────────────────────────────────────
    if (action === "respondInvite") {
      const { data: link } = await db.from("shop_partners").select("*").eq("id", params.partnershipId).maybeSingle();
      if (!link || link.shop_b !== myShop) return json({ error: "Invite not found" }, 404);
      if (link.status !== "invited") return json({ error: "This invite was already handled." }, 400);
      const accept = params.accept === true;
      const { data: updated } = await db.from("shop_partners")
        .update(accept ? { status: "active", accepted_at: new Date().toISOString(), specialty_b: params.specialty || null } : { status: "ended" })
        .eq("id", link.id).select().single();
      if (accept) {
        const myName = await shopDisplayName(db, myShop);
        await notifyAndEmail(db, {
          shopOwner: link.shop_a,
          eventType: "partner_invite_accepted",
          title: `${myName} accepted your partnership`,
          body: `You can now send jobs to ${myName} from any order — Send to Partner.`,
          relatedEntity: "shop_partner",
          relatedId: String(link.id),
          metadata: {},
        });
      }
      return json({ ok: true, partnership: updated });
    }

    // ── offer ──────────────────────────────────────────────────────────
    if (action === "offer") {
      const partnerShop = String(params.partnerShop || "").toLowerCase();
      const { data: link } = await db.from("shop_partners").select("id, status")
        .or(`and(shop_a.eq.${myShop},shop_b.eq.${partnerShop}),and(shop_a.eq.${partnerShop},shop_b.eq.${myShop})`)
        .eq("status", "active").limit(1).maybeSingle();
      if (!link) return json({ error: "No active partnership with that shop." }, 400);

      const { data: order } = await db.from("orders").select("*")
        .eq("shop_owner", myShop).eq("order_id", params.orderId).maybeSingle();
      if (!order) return json({ error: "Order not found" }, 404);

      const tradeTotal = Number(params.tradeTotal);
      if (!Number.isFinite(tradeTotal) || tradeTotal <= 0) {
        // Product decision (design doc): a hand-off carries a real trade
        // price so acceptance can snapshot it and invoicing can't drift.
        return json({ error: "Enter the agreed trade price for this hand-off." }, 400);
      }

      const blind = params.blind !== false; // default TRUE
      let spec = buildPartnerSpec(order, {
        lineIds: params.lineIds ?? null,
        blind,
        note: params.note || "",
      });
      if (!spec.lines.length) return json({ error: "Select at least one line to send." }, 400);
      spec = await copyArtwork(db, spec, partnerShop);

      const { data: handoff, error: hErr } = await db.from("partner_handoffs").insert({
        sending_shop: myShop,
        receiving_shop: partnerShop,
        source_order_id: order.order_id,
        source_line_ids: (params.lineIds ?? []).map(String),
        blind,
        due_date: params.dueDate || order.due_date || null,
        offered_trade_total: Math.round(tradeTotal * 100) / 100,
        note: params.note || null,
        spec,
      }).select().single();
      if (hErr) return json({ error: hErr.message }, 500);

      const myName = await shopDisplayName(db, myShop);
      await notifyAndEmail(db, {
        shopOwner: partnerShop,
        eventType: "partner_handoff_offered",
        title: `${myName} sent you a job offer`,
        body: `${spec.lines.length} line(s), due ${handoff.due_date || "TBD"}, trade price $${(Math.round(tradeTotal * 100) / 100).toFixed(2)}. Accept or decline from your Dashboard.`,
        relatedEntity: "partner_handoff",
        relatedId: String(handoff.id),
        metadata: { from_shop: myShop },
      });
      return json({ ok: true, handoff });
    }

    // ── respond (receiver) ─────────────────────────────────────────────
    if (action === "respond") {
      const { data: handoff } = await db.from("partner_handoffs").select("*").eq("id", params.handoffId).maybeSingle();
      if (!handoff || handoff.receiving_shop !== myShop) return json({ error: "Hand-off not found" }, 404);
      if (!["offered", "countered"].includes(handoff.status)) {
        return json({ error: "This hand-off was already handled." }, 400);
      }
      const response = String(params.response || "");
      const senderName = await shopDisplayName(db, handoff.sending_shop);
      const myName = await shopDisplayName(db, myShop);

      if (response === "decline") {
        await db.from("partner_handoffs").update({ status: "declined" }).eq("id", handoff.id);
        await notifyAndEmail(db, {
          shopOwner: handoff.sending_shop,
          eventType: "partner_handoff_declined",
          title: `${myName} declined the job for ${handoff.source_order_id}`,
          body: params.reason ? `Reason: ${params.reason}` : "You can re-offer it to another partner from the order.",
          relatedEntity: "partner_handoff",
          relatedId: String(handoff.id),
          metadata: {},
        });
        return json({ ok: true });
      }

      if (response === "counter") {
        if (!params.counterDueDate) return json({ error: "Pick the date you can deliver." }, 400);
        await db.from("partner_handoffs").update({ status: "countered", counter_due_date: params.counterDueDate }).eq("id", handoff.id);
        await notifyAndEmail(db, {
          shopOwner: handoff.sending_shop,
          eventType: "partner_handoff_countered",
          title: `${myName} can do ${handoff.source_order_id} — by ${params.counterDueDate}`,
          body: `They can't hit ${handoff.due_date || "the requested date"} but offered ${params.counterDueDate}. Accept the new date by re-sending, or decline.`,
          relatedEntity: "partner_handoff",
          relatedId: String(handoff.id),
          metadata: {},
        });
        return json({ ok: true });
      }

      if (response === "accept") {
        // SNAPSHOT: the offered trade price becomes the agreement, written
        // once — the receiver's invoice generates from this number.
        const agreed = Number(handoff.offered_trade_total);
        if (!Number.isFinite(agreed) || agreed <= 0) {
          return json({ error: "This offer has no trade price — ask the sender to re-offer with one." }, 400);
        }
        const orderId = newOrderId();
        const todayIso = new Date().toISOString().slice(0, 10);
        const insert = buildReceiverOrderInsert(
          { ...handoff, sending_shop_name: senderName, agreed_trade_total: agreed },
          orderId,
          todayIso,
        );
        const { error: oErr } = await db.from("orders").insert(insert);
        if (oErr) return json({ error: `Couldn't create the order: ${oErr.message}` }, 500);

        await db.from("partner_handoffs").update({
          status: "accepted",
          receiving_order_id: orderId,
          agreed_trade_total: agreed,
          accepted_at: new Date().toISOString(),
        }).eq("id", handoff.id);

        // Sender-side: cost + status chip on their order.
        await db.from("orders").update({ partner_status: "accepted", partner_cost: agreed })
          .eq("shop_owner", handoff.sending_shop)
          .eq("order_id", handoff.source_order_id);

        await notifyAndEmail(db, {
          shopOwner: handoff.sending_shop,
          eventType: "partner_handoff_accepted",
          title: `${myName} accepted the job for ${handoff.source_order_id}`,
          body: `Trade price $${agreed.toFixed(2)} · due ${insert.due_date || "TBD"}. Progress will mirror onto your order automatically; expect their invoice on completion.`,
          relatedEntity: "partner_handoff",
          relatedId: String(handoff.id),
          metadata: { receiving_order_id: orderId },
        });
        return json({ ok: true, receivingOrderId: orderId });
      }

      return json({ error: "Unknown response" }, 400);
    }

    // ── cancel (sender, before acceptance) ─────────────────────────────
    if (action === "cancel") {
      const { data: handoff } = await db.from("partner_handoffs").select("*").eq("id", params.handoffId).maybeSingle();
      if (!handoff || handoff.sending_shop !== myShop) return json({ error: "Hand-off not found" }, 404);
      if (!["offered", "countered"].includes(handoff.status)) {
        return json({ error: "Accepted hand-offs can't be cancelled here — coordinate with your partner." }, 400);
      }
      await db.from("partner_handoffs").update({ status: "cancelled" }).eq("id", handoff.id);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[partnerHandoff] error:", err);
    await captureError(err, { fn: "partnerHandoff" });
    return json({ error: "Something went wrong — please try again." }, 500);
  }
});
