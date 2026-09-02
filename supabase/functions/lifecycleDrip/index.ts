// Trial lifecycle drip — daily cron (GitHub Actions, lifecycle-drip.yml).
//
// Sends the two emails between the day-0 welcome and conversion:
//   drip_day2       → shops ≥2 days into an ACTIVE trial with zero quotes:
//                     "your first quote takes two minutes" activation nudge
//   trial_reminder  → shops with ≤3 days of trial left: honest heads-up
//                     (pick a plan / view-only otherwise, data stays)
//
// Authenticated by CRON_SECRET bearer (NOT user JWT) — same contract as
// qbReconcile. Dedup is one-per-shop-ever per event type via
// notification_log, so the daily window overlap can never double-send.
// trial_reminder deliberately SHARES its dedup key with billingWebhook's
// customer.subscription.trial_will_end handler: whichever path reaches a
// shop first (cardless trial → this cron; card-backed Stripe trial → the
// webhook) wins, and the shop only ever gets one trial-ending email.
//
// Selection is server-side and cheap: profiles is small, and each
// candidate costs at most two more queries (dedup check + quote count).
// PER_RUN_CAP bounds a pathological backlog; the cron catches up daily.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { sendResendEmail } from "../_shared/resendClient.js";
import { logNotificationAttempt } from "../_shared/approvalNotificationEmail.js";
import { buildDay2NudgeEmail, buildTrialEndingEmail } from "../_shared/dripEmails.ts";

const SEND_FROM = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";
const ADMIN_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "joe@biotamfg.co";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const DAY_MS = 86400000;
// Don't nudge shops that signed up long before the drip existed — a
// "day 2" email arriving on day 40 reads as a bug, not a nudge.
const DAY2_MAX_AGE_DAYS = 7;
const REMINDER_WINDOW_DAYS = 3;
const PER_RUN_CAP = 50;

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }
  const authHeader = req.headers.get("authorization") || "";
  if (!CRON_SECRET || !timingSafeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return new Response("unauthorized", { status: 401 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const now = Date.now();

  // Every shop owner on an ACTIVE trial. Expired trials are excluded by
  // the trial_ends_at bound; converted shops are tier 'shop' already.
  const { data: candidates, error: candErr } = await admin
    .from("profiles")
    .select("id, email, shop_name, company_name, created_at, trial_ends_at")
    .eq("role", "shop")
    .eq("subscription_tier", "trial")
    .not("auth_id", "is", null)
    .gt("trial_ends_at", new Date(now).toISOString());
  if (candErr) {
    console.error("[lifecycleDrip] candidate query failed:", candErr.message);
    return Response.json({ error: candErr.message }, { status: 500 });
  }

  const sent: Record<string, number> = { drip_day2: 0, trial_reminder: 0 };
  const failed: string[] = [];
  let budget = PER_RUN_CAP;

  async function alreadySent(eventType: string, email: string): Promise<boolean> {
    const { data } = await admin
      .from("notification_log")
      .select("id")
      .eq("event_type", eventType)
      .eq("shop_owner", email)
      .eq("status", "sent")
      .limit(1);
    return !!(data && data.length > 0);
  }

  async function send(
    eventType: "drip_day2" | "trial_reminder",
    email: string,
    built: { subject: string; html: string },
  ) {
    const result = await sendResendEmail({
      from: `InkTracker <${SEND_FROM}>`,
      to: [email],
      reply_to: ADMIN_EMAIL,
      subject: built.subject,
      html: built.html,
    });
    await logNotificationAttempt(admin, {
      shop_owner: email,
      event_type: eventType,
      recipient_email: email,
      subject: built.subject,
      status: result.ok ? "sent" : "failed",
      failure_reason: result.ok ? null : result.reason,
      resend_id: result.id ?? null,
    });
    if (result.ok) sent[eventType]++;
    else failed.push(`${eventType}:${email}`);
  }

  for (const p of candidates ?? []) {
    if (budget <= 0) break;
    if (!p.email) continue;
    const shopLabel = p.shop_name || p.company_name || "";
    const createdAt = new Date(p.created_at).getTime();
    const endsAt = new Date(p.trial_ends_at).getTime();
    if (!Number.isFinite(createdAt) || !Number.isFinite(endsAt)) continue;

    const ageDays = (now - createdAt) / DAY_MS;
    const daysLeft = Math.ceil((endsAt - now) / DAY_MS);

    // ── trial ending (checked first: if both windows somehow apply,
    //    the reminder matters more than the nudge) ──
    if (daysLeft <= REMINDER_WINDOW_DAYS) {
      if (!(await alreadySent("trial_reminder", p.email))) {
        await send("trial_reminder", p.email, buildTrialEndingEmail({
          email: p.email,
          shopName: shopLabel,
          daysLeft,
        }));
        budget--;
      }
      continue;
    }

    // ── day-2 activation nudge (no REAL quotes yet) ──
    if (ageDays >= 2 && ageDays <= DAY2_MAX_AGE_DAYS) {
      if (await alreadySent("drip_day2", p.email)) continue;
      // "Have they made a quote of their OWN?" — NOT "any quote". Every
      // new signup is seeded with demo quotes (quote_id carries a DEMO/
      // TEST segment, per the reserved test namespace #836), so a plain
      // count is ≥5 for everyone from the moment they arrive and this
      // gate never opens. That silently killed the day-2 nudge for the
      // entire demo-seeding era (only pre-seed shops ever got it). Count
      // only non-seed quotes so "hasn't activated" means what it says.
      const { count, error: qErr } = await admin
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("shop_owner", p.email)
        .not("quote_id", "ilike", "%DEMO%")
        .not("quote_id", "ilike", "%TEST%");
      if (qErr) {
        console.error(`[lifecycleDrip] quote count failed for ${p.email}:`, qErr.message);
        continue;
      }
      if ((count ?? 0) > 0) continue; // they made a real quote — no nudge needed
      await send("drip_day2", p.email, buildDay2NudgeEmail({
        email: p.email,
        shopName: shopLabel,
      }));
      budget--;
    }
  }

  const summary = {
    candidates: candidates?.length ?? 0,
    sent,
    failed,
    capped: budget <= 0,
  };
  console.log("[lifecycleDrip]", JSON.stringify(summary));
  return Response.json(summary);
});
