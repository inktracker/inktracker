// Order comments — the team thread on a job, with @mention notifications.
//
// Actions:
//   roster — team members of the caller's shop (owner + employees/managers),
//            for the @mention picker. Names + emails only, no roles/money.
//   post   — insert a comment and fan out addressed notification rows
//            (mentions + the owner). The notifications INSERT trigger
//            (pg_net → sendPush) then delivers push per recipient.
//
// Auth: adminAction pattern — anon client + caller JWT for identity,
// service role for writes. Writes are service-only at the RLS layer so a
// comment can never skip (or forge) its notifications.
//
// Brokers are denied: this is the INTERNAL thread; broker/customer
// communication stays on the existing messages rails.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  validateMentions,
  buildCommentNotificationRows,
} from "../_shared/orderComments.js";
import { notifyPrefEnabled } from "../_shared/notificationPrefs.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

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

    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user?.email) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name, first_name, last_name, role, shop_owner, assigned_shops")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (!profile?.email) return json({ error: "No profile" }, 403);
    if (profile.role === "broker") return json({ error: "Not available for broker accounts" }, 403);

    // Tenant scope: owners are their own shop; employees/managers inherit
    // their profile's shop_owner (the same server-side derivation qbSync
    // uses — the caller never names a shop). Fail closed if empty.
    const shopOwner: string = profile.shop_owner || profile.email;
    if (!shopOwner) return json({ error: "Unable to derive shop" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    // Roster: everyone who can appear in an @mention. Owner first.
    async function loadRoster() {
      const { data: members } = await admin
        .from("profiles")
        .select("email, full_name, first_name, last_name, role")
        .or(`email.eq.${shopOwner},shop_owner.eq.${shopOwner}`)
        .in("role", ["shop", "admin", "employee", "manager"]);
      const display = (m: any) =>
        (m.full_name || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || "").trim();
      const seen = new Set<string>();
      const roster: { email: string; name: string }[] = [];
      for (const m of members ?? []) {
        const email = String(m.email || "").toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        roster.push({ email, name: display(m) });
      }
      return roster;
    }

    if (action === "roster") {
      return json({ roster: await loadRoster() });
    }

    if (action === "post") {
      const orderId = String(body?.orderId ?? "").trim();
      const text = String(body?.body ?? "").trim();
      if (!orderId) return json({ error: "orderId required" }, 400);
      if (!text) return json({ error: "Comment can't be empty" }, 400);
      if (text.length > 4000) return json({ error: "Comment too long (4,000 characters max)" }, 400);

      // The order must exist in THIS shop — the caller's claim alone is
      // never enough to anchor a comment (and its notifications) to a row.
      const { data: order } = await admin
        .from("orders")
        .select("id, order_id, shop_owner")
        .eq("shop_owner", shopOwner)
        .eq("order_id", orderId)
        .maybeSingle();
      if (!order) return json({ error: "Order not found" }, 404);

      const roster = await loadRoster();
      const authorName =
        (profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email).trim();
      const validMentions = validateMentions(body?.mentions, roster, profile.email);

      const { data: comment, error: insErr } = await admin
        .from("order_comments")
        .insert({
          shop_owner: shopOwner,
          order_id: orderId,
          author_email: profile.email.toLowerCase(),
          author_name: authorName,
          body: text,
          mentions: validMentions,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      let rows = buildCommentNotificationRows({
        shopOwner,
        orderId,
        orderRowId: order.id,
        authorEmail: profile.email,
        authorName,
        body: text,
        validMentions,
      });
      // Shop pref: the owner's automatic copy of every comment is optional.
      // Rows born from an explicit @mention always survive the filter.
      const { data: shopRow } = await admin
        .from("shops").select("notification_prefs").eq("owner_email", shopOwner).maybeSingle();
      if (!notifyPrefEnabled(shopRow?.notification_prefs, "comment_copies")) {
        rows = rows.filter((r) => r.metadata?.mentioned === true);
      }
      if (rows.length > 0) {
        // Notification failure must not eat the comment — it's saved; log loud.
        const { error: notifErr } = await admin.from("notifications").insert(rows);
        if (notifErr) console.error("[orderComments] notification insert failed:", notifErr.message);
      }

      return json({ ok: true, comment, notified: rows.map((r) => r.recipient_email) });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[orderComments]", msg);
    return json({ error: "Something went wrong posting the comment. Please try again." }, 500);
  }
});
