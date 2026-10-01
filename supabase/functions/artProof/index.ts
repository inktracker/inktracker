import { resolveArtworkPath } from "../_shared/artworkPath.js";
import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { loadProfileWithSecrets, loadShopProfileForUser } from "../_shared/profileSecrets.ts";
import { planSendProof, planOverride } from "../_shared/artProofEffects.js";
import { proofReminderDue } from "../_shared/artApproval.js";
import { sendAndLogApprovalNotification } from "../_shared/approvalNotificationEmail.js";
import { insertShopNotification } from "../_shared/notifications.js";
import { renderEmailLayout, renderEmailButton } from "../_shared/emailLayout.ts";
import { escapeHtml } from "../_shared/emailSanitize.js";

// Artwork proofs — shop-side actions. Supabase Edge Function.
//
//   send      → new proof version from the order's current art; emails the
//               customer a "Review and approve" link (any shop team member
//               except brokers)
//   override  → owner/manager marks the art approved without the customer
//               (e.g. approved by phone); a note is required and recorded
//   remind    → nightly (Authorization: Bearer CRON_SECRET): one reminder
//               to customers who haven't answered a proof in 2 days
//
// Customer responses (approve / request changes) live in
// createCheckoutSession, next to the approval page's other actions. Logic:
// _shared/artApproval.js + _shared/artProofEffects.js.

// deno-lint-ignore no-explicit-any
type Any = any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const TEAM_ROLES = ["admin", "shop", "manager", "employee"];
const OVERRIDE_ROLES = ["admin", "shop", "manager"];

export type Deps = {
  admin: Any;
  getUser: (token: string) => Promise<Any>;
  env: (k: string) => string | undefined;
  send?: (admin: Any, payload: Any) => Promise<Any>;
  now?: () => Date;
};

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function approvalUrl(env: Deps["env"], order: Any) {
  const base = (env("PUBLIC_APP_URL") ?? "https://www.inktracker.app").replace(/\/$/, "");
  return `${base}/ArtApproval?id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.public_token)}`;
}

/** Who gets the proof: a broker order goes to the broker (their client). */
export function proofRecipient(order: Any, override?: string) {
  const typed = String(override ?? "").trim();
  if (typed.includes("@")) return { to: typed, role: order?.broker_id ? "broker" : "customer" };
  if (order?.broker_id && String(order.broker_id).includes("@")) return { to: String(order.broker_id), role: "broker" };
  return { to: String(order?.customer_email ?? "").trim(), role: "customer" };
}

const RASTER = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Pictures for the proof email: a mockup's PNG preview, or any uploaded art
 * that is itself an image. Served through the token-checked artworkProof
 * proxy at w=1024 (email bodies render ~600px; the print original would be
 * wasted egress). PDFs/AI files have no picture and stay as names.
 */
export function proofImageUrls(order: Any, supabaseUrl: string | undefined, token: string) {
  const base = String(supabaseUrl || "").replace(/\/$/, "");
  if (!base || !token || !order?.id) return [];
  const out: { url: string; name: string }[] = [];
  for (const a of Array.isArray(order.selected_artwork) ? order.selected_artwork : []) {
    let path = a?.preview?.path ? String(a.preview.path) : null;
    if (!path) {
      const own = resolveArtworkPath(a?.path || a?.url || a?.file_url);
      if (own && RASTER.test(String(own).split("?")[0])) path = own;
    }
    if (!path) continue;
    out.push({
      url: `${base}/functions/v1/artworkProof?type=order&id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}&w=1024`,
      name: String(a?.name || "Artwork"),
    });
    if (out.length >= 3) break;
  }
  return out;
}

export function buildProofEmail({ order, version, shopName, logoUrl, message, url, files, images = [], reminder = false }: Any) {
  const what = order.job_title ? `${order.job_title} (${order.order_id})` : order.order_id;
  const subject = reminder
    ? `Reminder: your proof for ${what} is waiting for approval`
    : `Proof ${version > 1 ? `v${version} ` : ""}ready for approval: ${what}`;
  const fileList = (files ?? []).slice(0, 10).map((f: Any) => `<li>${escapeHtml(f.name)}</li>`).join("");
  const html = renderEmailLayout({
    shopName,
    logoUrl,
    subhead: "Artwork proof",
    contentHtml:
      `<p style="margin:0 0 12px">Hi${order.customer_name ? ` ${escapeHtml(order.customer_name)}` : ""},</p>` +
      `<p style="margin:0 0 12px">${reminder
        ? "Just a reminder: we're waiting on your approval before we start printing."
        : `Your artwork proof${version > 1 ? ` (version ${version})` : ""} is ready. Please check every detail, then approve it or tell us what to change.`}</p>` +
      (message ? `<p style="margin:0 0 12px;white-space:pre-line">${escapeHtml(message)}</p>` : "") +
      (images ?? []).map((im: Any) =>
        `<p style="margin:0 0 12px"><a href="${escapeHtml(url)}"><img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.name)}" width="520" style="max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:8px;display:block"></a></p>`).join("") +
      (fileList ? `<ul style="margin:0 0 16px;padding-left:18px">${fileList}</ul>` : "") +
      renderEmailButton("Review and approve", url) +
      `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">Production starts once you approve.</p>`,
  });
  return { subject, html };
}

async function loadOrderForShop(admin: Any, orderId: string, shopOwner: string) {
  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || order.shop_owner !== shopOwner) return null;
  const { data: proofs } = await admin.from("art_proofs").select("id, version, status").eq("order_id", orderId);
  return { order, proofs: proofs ?? [] };
}

async function ensurePublicToken(admin: Any, order: Any) {
  if (order.public_token) return order.public_token;
  const token = crypto.randomUUID();
  const { data } = await admin.from("orders").update({ public_token: token }).eq("id", order.id).is("public_token", null).select("public_token");
  if (data?.[0]?.public_token) return data[0].public_token;
  const { data: again } = await admin.from("orders").select("public_token").eq("id", order.id).maybeSingle();
  return again?.public_token ?? token;
}

async function shopBrand(admin: Any, shopOwner: string) {
  const { data } = await admin.from("profiles").select("shop_name, logo_url").eq("email", shopOwner).maybeSingle();
  return { shopName: data?.shop_name || "Your print shop", logoUrl: data?.logo_url || undefined };
}

const defaultSend = (admin: Any, payload: Any) => sendAndLogApprovalNotification(admin, payload);

/** Nightly: one reminder per proof left unanswered for 2+ days. */
export async function sendReminders(deps: Deps): Promise<{ reminded: number }> {
  const { admin } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const { data: waiting } = await admin.from("art_proofs")
    .select("id, order_id, version, status, sent_at, sent_to, reminder_sent_at, shop_owner")
    .eq("status", "sent").is("reminder_sent_at", null)
    .lt("sent_at", new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString())
    .order("sent_at", { ascending: true }).limit(200);
  let reminded = 0;
  for (const p of waiting ?? []) {
    if (!proofReminderDue(p, now.getTime())) continue;
    const { data: order } = await admin.from("orders").select("*").eq("id", p.order_id).maybeSingle();
    // Only the proof the order is still waiting on, while the order is still
    // in Art Approval (with the gate off a job can move on unanswered — no
    // "before we start printing" email for a job already printing). Rows
    // that will never be reminded are taken out of the queue so they can't
    // crowd out newer ones.
    const remindable = order && order.public_token && order.art_status === "sent" &&
      Number(order.art_proof_version) === Number(p.version) &&
      (!order.status || order.status === "Art Approval");
    if (!remindable) {
      await admin.from("art_proofs").update({ reminder_sent_at: now.toISOString() }).eq("id", p.id).is("reminder_sent_at", null);
      continue;
    }
    // Claim first so a re-run can't double-remind.
    const { data: claimed } = await admin.from("art_proofs").update({ reminder_sent_at: now.toISOString() }).eq("id", p.id).is("reminder_sent_at", null).select("id");
    if (!claimed?.length) continue;
    const brand = await shopBrand(admin, order.shop_owner);
    const to = p.sent_to || proofRecipient(order).to;
    if (!to) continue;
    const { subject, html } = buildProofEmail({
      order, version: p.version, ...brand, url: approvalUrl(deps.env, order), reminder: true,
      images: proofImageUrls(order, deps.env("SUPABASE_URL"), order.public_token),
    });
    await (deps.send ?? defaultSend)(admin, {
      shop_owner: order.shop_owner, event_type: "art_proof_reminder", order_id: order.id,
      recipient_email: to, recipient_role: order.broker_id ? "broker" : "customer",
      to, subject, html, reply_to: order.shop_owner,
    });
    await insertShopNotification(admin, <Any>{
      shopOwner: order.shop_owner, eventType: "art_proof_reminder", severity: "info",
      title: `Still waiting on art approval: ${order.order_id}`,
      body: `Proof v${p.version} has been waiting 2 days. We sent the customer a reminder.`,
      relatedEntity: "order", relatedId: order.id,
    });
    reminded++;
  }
  return { reminded };
}

export async function handle(req: Request, deps: Deps) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const admin = deps.admin;

  if (action === "remind") {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!sameSecret(bearer, deps.env("CRON_SECRET") ?? "")) return json({ error: "unauthorized" }, 401);
    return json({ ok: true, ...(await sendReminders(deps)) });
  }

  const token = body.accessToken || req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const user = await deps.getUser(token);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const viewer = await loadProfileWithSecrets(admin, { auth_id: user.id });
  if (!TEAM_ROLES.includes(viewer?.role)) return json({ error: "Not available for this account." }, 403);
  const { profile: shop } = await loadShopProfileForUser(admin, user.id);
  if (!shop?.email) return json({ error: "Shop not found" }, 404);
  const viewerName = String(viewer?.full_name || [viewer?.first_name, viewer?.last_name].filter(Boolean).join(" ") || viewer?.email || "Shop").trim();

  const loaded = await loadOrderForShop(admin, String(body.orderId ?? ""), String(shop.email));
  if (!loaded) return json({ error: "Order not found." }, 404);
  const { order, proofs } = loaded;
  const now = (deps.now ?? (() => new Date()))().toISOString();

  if (action === "send") {
    const recipient = proofRecipient(order, body.to);
    const plan: Any = planSendProof({ order, proofs, sentBy: viewerName, sentTo: recipient.to, message: body.message, now });
    if (!plan.ok) return json({ error: plan.error }, 400);
    const publicToken = await ensurePublicToken(admin, order);
    if (plan.supersede.length) await admin.from("art_proofs").update({ status: "superseded" }).in("id", plan.supersede);
    const { error: insErr } = await admin.from("art_proofs").insert(plan.insert);
    if (insErr) return json({ error: "Couldn't save the proof. Try again." }, 500);
    const { data: updated, error: updErr } = await admin.from("orders").update(plan.orderPatch).eq("id", order.id).select("*");
    if (updErr || !updated?.[0]) return json({ error: "Couldn't update the order. Try again." }, 500);
    const brand = await shopBrand(admin, order.shop_owner);
    const { subject, html } = buildProofEmail({
      order: { ...order, public_token: publicToken }, version: plan.version, ...brand, message: body.message,
      url: approvalUrl(deps.env, { ...order, public_token: publicToken }), files: plan.insert.snapshot.files,
      images: proofImageUrls(order, deps.env("SUPABASE_URL"), publicToken),
    });
    const sent = await (deps.send ?? defaultSend)(admin, {
      shop_owner: order.shop_owner, event_type: "art_proof_sent", order_id: order.id,
      recipient_email: recipient.to, recipient_role: recipient.role,
      to: recipient.to, subject, html, reply_to: order.shop_owner,
    });
    return json({ ok: true, version: plan.version, sentTo: recipient.to, emailed: sent?.ok !== false, order: updated[0] });
  }

  if (action === "override") {
    if (!OVERRIDE_ROLES.includes(viewer?.role)) return json({ error: "Only the owner or a manager can approve art for the customer." }, 403);
    const plan: Any = planOverride({ order, proofs, byName: viewerName, note: body.note, now });
    if (!plan.ok) return json({ error: plan.error }, 400);
    if (plan.supersede.length) await admin.from("art_proofs").update({ status: "superseded" }).in("id", plan.supersede);
    const { error: insErr } = await admin.from("art_proofs").insert(plan.insert);
    if (insErr) return json({ error: "Couldn't save the approval. Try again." }, 500);
    const { data: updated, error: updErr } = await admin.from("orders").update(plan.orderPatch).eq("id", order.id).select("*");
    if (updErr || !updated?.[0]) return json({ error: "Couldn't update the order. Try again." }, 500);
    return json({ ok: true, version: plan.version, order: updated[0] });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}

if (import.meta.main) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  Deno.serve(async (req) => {
    try {
      return await handle(req, {
        admin,
        getUser: async (token) => {
          const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: `Bearer ${token}` } },
          });
          const { data: { user } } = await userClient.auth.getUser(token);
          return user ?? null;
        },
        env: (k) => Deno.env.get(k),
      });
    } catch (err) {
      console.error("[artProof]", err);
      return json({ error: "Something went wrong. Try again in a moment." }, 500);
    }
  });
}
