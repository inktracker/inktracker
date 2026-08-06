// Floor discrepancy reporting — Edit Order decision #2 (2026-08-06):
// employees never change actual quantities; they MARK differences. The
// mark becomes (a) a dated line in the order's shop-facing notes, (b) a
// bell notification to the owner + managers (team bell, #731), and (c)
// an explicit change_log row with the reporter as actor. Acting on the
// mark — the quantity edit, the rebill — stays owner/manager, in the
// tiered order editor where pending marks render inline.
//
// The floor has a voice, not a pen.
//
// Deploy: npx supabase functions deploy reportDiscrepancy --no-verify-jwt
// (auth validated internally from the Authorization header, adminAction
// pattern — anon key + caller JWT for identity, service role for writes.)

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { recordShopNotification } from "../_shared/shopNotifications.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = clean(body.orderId);
    const lineLabel = clean(body.lineLabel).slice(0, 120);
    const size = clean(body.size).slice(0, 20);
    const qty = Number(body.qty);
    const reason = clean(body.reason).slice(0, 300);
    if (!orderId || !size || !Number.isFinite(qty) || qty <= 0) {
      return json({ error: "orderId, size, and a positive qty are required" }, 400);
    }

    // Caller identity + tenancy: their profile must cover the order's shop
    // (owner by email, team member via assigned_shops).
    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name, role, assigned_shops")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (!profile?.email) return json({ error: "Profile not found" }, 403);

    const { data: order } = await admin
      .from("orders")
      .select("id, order_id, shop_owner, customer_name, notes")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);

    const covers =
      profile.email === order.shop_owner ||
      (Array.isArray(profile.assigned_shops) && profile.assigned_shops.includes(order.shop_owner));
    if (!covers) return json({ error: "Order not found" }, 404); // opaque — don't leak existence

    const reporter = profile.full_name || profile.email;
    const today = new Date().toISOString().split("T")[0];
    const detail = `${qty} ${reason || "short"} on ${size}${lineLabel ? ` / ${lineLabel}` : ""}`;
    const noteLine = `[${today}] ${reporter} reported a discrepancy: ${detail}`;

    // (a) dated shop-facing note — accumulates, never overwrites.
    const notes = clean(order.notes) ? `${order.notes}\n${noteLine}` : noteLine;
    const { error: noteErr } = await admin.from("orders").update({ notes }).eq("id", order.id);
    if (noteErr) return json({ error: "Couldn't record the report — try again." }, 500);

    // (b) bell notification → owner + managers (RLS routes it).
    await recordShopNotification(admin, {
      shopOwner: order.shop_owner,
      eventType: "floor_discrepancy",
      severity: "warning",
      title: `Discrepancy reported on ${order.order_id}`,
      body: `${reporter}: ${detail}. ${order.customer_name ? `Customer: ${order.customer_name}. ` : ""}Open the order to adjust quantities or rebill.`,
      relatedEntity: "order",
      relatedId: order.id,
      metadata: { size, qty, reason: reason || "short", reporter: profile.email },
    });

    // (c) explicit change_log row — the trigger skips notes-only writes by
    // design, and a service-role write would attribute to 'system'; the
    // floor's report deserves the reporter's name.
    await admin.from("change_log").insert({
      shop_owner: order.shop_owner,
      entity_type: "order",
      entity_id: String(order.id),
      entity_ref: order.order_id,
      source: "inktracker",
      actor: profile.email,
      summary: `Reported a discrepancy — ${detail}`,
      changes: [],
      metadata: { size, qty, reason: reason || "short" },
    });

    return json({ ok: true, noteLine });
  } catch (err) {
    console.error("[reportDiscrepancy] error:", (err as Error)?.message ?? err);
    return json({ error: "Something went wrong — try again." }, 500);
  }
});
