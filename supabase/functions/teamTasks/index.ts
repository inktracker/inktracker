// Team tasks — delegation with assignment notifications.
//
// Actions:
//   create   — { title, details?, orderId?, assigneeEmail?, dueDate? }
//   assign   — { taskId, assigneeEmail }   (empty email = unassign)
//   complete — { taskId }
//   reopen   — { taskId }
//   remove   — { taskId }                  (owner only)
//
// Auth: adminAction pattern — anon client + caller JWT for identity,
// service role for writes. shop_tasks writes are service-only at the RLS
// layer so a task can never skip (or forge) its notifications. Brokers
// denied; reads happen client-side under RLS.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  validateTaskTitle,
  validateDueDate,
  validateAssignee,
  buildAssignmentNotification,
  buildCompletionNotification,
} from "../_shared/teamTasks.js";
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
      .select("email, full_name, first_name, last_name, role, shop_owner")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (!profile?.email) return json({ error: "No profile" }, 403);
    if (profile.role === "broker") return json({ error: "Not available for broker accounts" }, 403);

    const shopOwner: string = profile.shop_owner || profile.email;
    if (!shopOwner) return json({ error: "Unable to derive shop" }, 403);
    const isOwner = profile.email === shopOwner || profile.role === "admin";
    const actorName =
      (profile.full_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email).trim();

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

    // Resolve an order's row id for the bell's deep-link (and prove the
    // order belongs to THIS shop — a caller-supplied id is never enough).
    async function orderRowId(orderId: string | null): Promise<string | null> {
      if (!orderId) return null;
      const { data } = await admin
        .from("orders")
        .select("id")
        .eq("shop_owner", shopOwner)
        .eq("order_id", orderId)
        .maybeSingle();
      return data?.id ?? null;
    }

    async function getTask(taskId: string) {
      const { data } = await admin
        .from("shop_tasks")
        .select("*")
        .eq("id", taskId)
        .eq("shop_owner", shopOwner)
        .maybeSingle();
      return data ?? null;
    }

    async function notify(row: Record<string, unknown> | null) {
      if (!row) return;
      // Shop pref: task pings can be turned off wholesale.
      const { data: shopRow } = await admin
        .from("shops").select("notification_prefs").eq("owner_email", shopOwner).maybeSingle();
      if (!notifyPrefEnabled(shopRow?.notification_prefs, "task_pings")) return;
      const { error } = await admin.from("notifications").insert(row);
      if (error) console.error("[teamTasks] notification insert failed:", error.message);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "create") {
      const vt = validateTaskTitle(body?.title);
      if (!vt.ok) return json({ error: vt.error }, 400);
      const vd = validateDueDate(body?.dueDate);
      if (!vd.ok) return json({ error: vd.error }, 400);
      const roster = await loadRoster();
      const va = validateAssignee(body?.assigneeEmail, roster);
      if (!va.ok) return json({ error: va.error }, 400);

      const orderId = String(body?.orderId ?? "").trim() || null;
      const rowId = await orderRowId(orderId);
      if (orderId && !rowId) return json({ error: "Order not found" }, 404);

      const { data: task, error: insErr } = await admin
        .from("shop_tasks")
        .insert({
          shop_owner: shopOwner,
          order_id: orderId,
          title: vt.title,
          details: String(body?.details ?? "").slice(0, 2000),
          assignee_email: va.assignee?.email ?? null,
          assignee_name: va.assignee?.name ?? null,
          due_date: vd.dueDate,
          created_by: profile.email.toLowerCase(),
          created_by_name: actorName,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      await notify(buildAssignmentNotification({ shopOwner, task, actorEmail: profile.email, orderRowId: rowId }));
      return json({ ok: true, task });
    }

    if (action === "assign") {
      const task = await getTask(String(body?.taskId ?? ""));
      if (!task) return json({ error: "Task not found" }, 404);
      const roster = await loadRoster();
      const va = validateAssignee(body?.assigneeEmail, roster);
      if (!va.ok) return json({ error: va.error }, 400);

      const { data: updated, error: upErr } = await admin
        .from("shop_tasks")
        .update({ assignee_email: va.assignee?.email ?? null, assignee_name: va.assignee?.name ?? null })
        .eq("id", task.id)
        .select()
        .single();
      if (upErr) throw upErr;

      const rowId = await orderRowId(updated.order_id);
      await notify(buildAssignmentNotification({
        shopOwner,
        task: { ...updated, created_by_name: actorName },
        actorEmail: profile.email,
        orderRowId: rowId,
      }));
      return json({ ok: true, task: updated });
    }

    if (action === "complete" || action === "reopen") {
      const task = await getTask(String(body?.taskId ?? ""));
      if (!task) return json({ error: "Task not found" }, 404);
      const done = action === "complete";
      const { data: updated, error: upErr } = await admin
        .from("shop_tasks")
        .update(done
          ? { status: "done", done_at: new Date().toISOString(), done_by: profile.email.toLowerCase() }
          : { status: "open", done_at: null, done_by: null })
        .eq("id", task.id)
        .select()
        .single();
      if (upErr) throw upErr;

      if (done) {
        const rowId = await orderRowId(updated.order_id);
        await notify(buildCompletionNotification({ shopOwner, task: updated, actorEmail: profile.email, actorName, orderRowId: rowId }));
      }
      return json({ ok: true, task: updated });
    }

    if (action === "remove") {
      if (!isOwner) return json({ error: "Only the shop owner can delete tasks" }, 403);
      const task = await getTask(String(body?.taskId ?? ""));
      if (!task) return json({ error: "Task not found" }, 404);
      const { error: delErr } = await admin.from("shop_tasks").delete().eq("id", task.id);
      if (delErr) throw delErr;
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[teamTasks]", msg);
    return json({ error: "Something went wrong with that task. Please try again." }, 500);
  }
});
