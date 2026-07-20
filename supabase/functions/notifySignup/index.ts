// New-signup notification → platform admin.
//
// Called by a pg_net database trigger (AFTER INSERT ON public.profiles,
// migration 20260905000000_signup_notify) with { record: { id } }. Sends
// Joe one email per new profile so signups are visible without watching
// the dashboard.
//
// Endpoint hardening: verify_jwt=false (pg_net can't attach a user JWT),
// so the function is SELF-VALIDATING instead of trusting the payload —
// it re-reads the profile server-side and only emails when the row (a)
// exists, (b) was created in the last 48h, and (c) hasn't been notified
// before (notification_log dedup). A spammed endpoint can therefore only
// produce emails the admin was getting anyway, once each.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { sendResendEmail } from "../_shared/resendClient.js";
import { logNotificationAttempt } from "../_shared/approvalNotificationEmail.js";
import { escapeHtml } from "../_shared/emailSanitize.js";

const SEND_FROM = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";
// Where signup notifications land. Env-overridable so a future teammate
// or a group alias doesn't need a redeploy-with-code-change.
const ADMIN_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") ?? "joe@biotamfg.co";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const profileId = payload?.record?.id;
    if (!profileId || typeof profileId !== "string") {
      return Response.json({ error: "record.id required" }, { status: 400 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, role, subscription_tier, subscription_status, shop_name, company_name, shop_owner, created_at")
      .eq("id", profileId)
      .maybeSingle();
    if (!profile?.email) {
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    const ageMs = Date.now() - new Date(profile.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 48 * 60 * 60 * 1000) {
      // Replayed/stale webhook — a real trigger fires within seconds.
      return Response.json({ skipped: "stale" });
    }

    // One email per profile, ever. shop_owner column carries the NEW
    // user's email here (it's the row's tenant key for this event type).
    // Dedup on sent only — a failed attempt shouldn't block a manual retry.
    const { data: already } = await admin
      .from("notification_log")
      .select("id")
      .eq("event_type", "signup_notify")
      .eq("shop_owner", profile.email)
      .eq("status", "sent")
      .limit(1);
    if (already && already.length > 0) {
      return Response.json({ skipped: "already_notified" });
    }

    // Self-signups land as role=shop/tier=trial (handle_new_user);
    // anything else is a team/broker invite — label it so the email
    // reads correctly for both.
    const isSelfSignup = profile.role === "shop";
    const kind = isSelfSignup ? "New shop signup" : `New ${profile.role || "user"} invited`;
    const shopLabel = profile.shop_name || profile.company_name || "";
    const subject = `${kind}: ${profile.email}${shopLabel ? ` — ${shopLabel}` : ""}`;

    const line = (label: string, value: unknown) =>
      value
        ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${label}</td><td style="padding:4px 0;font-size:13px;">${escapeHtml(String(value))}</td></tr>`
        : "";
    const html = `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;">
        <h2 style="font-size:16px;margin:0 0 12px;">${escapeHtml(kind)}</h2>
        <table style="border-collapse:collapse;">
          ${line("Email", profile.email)}
          ${line("Shop", shopLabel)}
          ${line("Role", profile.role)}
          ${line("Tier", profile.subscription_tier)}
          ${line("Status", profile.subscription_status)}
          ${line("Invited by", isSelfSignup ? "" : profile.shop_owner)}
          ${line("Signed up", new Date(profile.created_at).toUTCString())}
        </table>
      </div>`;

    const result = await sendResendEmail({
      from: `InkTracker <${SEND_FROM}>`,
      to: [ADMIN_EMAIL],
      subject,
      html,
    });

    await logNotificationAttempt(admin, {
      shop_owner: profile.email,
      event_type: "signup_notify",
      recipient_email: ADMIN_EMAIL,
      subject,
      status: result.ok ? "sent" : "failed",
      failure_reason: result.ok ? null : result.reason,
      resend_id: result.id ?? null,
    });

    return Response.json({ sent: result.ok, reason: result.reason ?? null });
  } catch (err) {
    console.error("[notifySignup] error:", err);
    return Response.json({ error: String((err as any)?.message ?? err) }, { status: 500 });
  }
});
