// Supplier setup (S&S Activewear + AS Colour) — Supabase Edge Function
//
// The in-app setup steppers for the two suppliers that DON'T run a
// supplier-side test (SanMar's is smOnboarding). What this adds beyond
// saving credentials is a real VERIFICATION with the shop's own account and
// the two AS Colour request emails, so a shop never has to write to a
// supplier or wonder whether the key it pasted actually works:
//
//   status               → progress + connection flags
//   ssVerify             → authenticated S&S call with the SHOP's account # +
//                          API key (no platform fallback). Success proves the
//                          account that ssPlaceOrder will bill.
//   acRequestApi         → emails api@ascolour.com for API credentials
//   acMarkApiRequested   → shop already asked
//   acVerify             → mints an AS Colour bearer token with the shop's
//                          subscription key + email + password (all three)
//   acRequestCredit      → emails support@ascolour.com for the credit
//                          application (API orders need credit terms)
//   acMarkCreditRequested / acMarkCreditApproved / acUnmarkCreditApproved
//
// Emails go FROM InkTracker with reply-to + cc the shop owner. Auth: signed-in
// owner/manager (canPlaceOrder), acting on the shop owner's profile.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { canPlaceOrder } from "../_shared/acOrderLogic.js";
import { loadShopProfileForUser, loadProfileWithSecrets } from "../_shared/profileSecrets.ts";
import { sendResendEmail } from "../_shared/resendClient.js";
import { credsFromProfile as acCredsFromProfile, getAcBearerToken } from "../_shared/ascolour.ts";
import {
  AC_API_EMAIL,
  AC_SUPPORT_EMAIL,
  normalizeSupplierSetup,
  applySsVerified,
  applyAcApiRequested,
  applyAcVerified,
  applyAcCreditRequested,
  applyAcCreditApproved,
  buildAcApiRequestEmail,
  buildAcCreditRequestEmail,
} from "../_shared/supplierSetup.js";

const SEND_FROM = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";
const SS_BASE = "https://api.ssactivewear.com/v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

// deno-lint-ignore no-explicit-any
type AnyProfile = Record<string, any>;

// deno-lint-ignore no-explicit-any
async function saveSetup(admin: any, profileId: string, setup: unknown) {
  const { error } = await admin.from("profiles").update({ supplier_setup: setup }).eq("id", profileId);
  if (error) throw new Error(`Couldn't save setup progress: ${error.message}`);
}

function statusPayload(profile: AnyProfile) {
  return {
    setup: normalizeSupplierSetup(profile.supplier_setup),
    flags: {
      ss: Boolean(profile.ss_account_number && profile.ss_api_key),
      ss_account: profile.ss_account_number || null,
      ac: Boolean(profile.ac_subscription_key),
      ac_email: profile.ac_email || null,
      ac_password: Boolean(profile.ac_password),
    },
    ownerEmail: profile.email || null,
    shopName: profile.company_name || profile.shop_name || "",
  };
}

async function sendShopEmail(profile: AnyProfile, to: string, email: { subject: string; text: string; html: string }) {
  return await sendResendEmail({
    from: `InkTracker <${SEND_FROM}>`,
    to: [to],
    cc: [profile.email],
    reply_to: profile.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const headerToken = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const token = body.accessToken || headerToken;
    if (!token) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const callerProfile = await loadProfileWithSecrets(admin, { auth_id: user.id });
    if (!canPlaceOrder(callerProfile)) {
      return json({ error: "Only the shop owner or a manager can set up supplier ordering." }, 403);
    }
    const { profile: rawProfile } = await loadShopProfileForUser(admin, user.id);
    const profile = rawProfile as AnyProfile | null;
    if (!profile) return json({ error: "Profile not found" }, 404);

    const action = String(body.action || "status");
    if (action === "status") return json(statusPayload(profile));

    const shopName = profile.company_name || profile.shop_name || "our shop";
    const ownerName = profile.full_name || profile.name || "";

    // ── S&S: verify with the shop's own account ──────────────────────
    if (action === "ssVerify") {
      const acct = String(profile.ss_account_number || "").trim();
      const key = String(profile.ss_api_key || "").trim();
      if (!acct || !key) return json({ error: "Save your S&S account number and API key first." }, 400);
      let status = 0;
      let ok = false;
      try {
        const res = await fetch(`${SS_BASE}/styles?search=G500`, {
          headers: { Authorization: `Basic ${btoa(`${acct}:${key}`)}`, Accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        status = res.status;
        const data = await res.json().catch(() => null);
        ok = res.ok && Array.isArray(data);
      } catch (e) {
        console.error("[supplierSetup] ssVerify fetch failed:", (e as Error).message);
      }
      if (!ok) {
        const why = status === 401 || status === 403
          ? "S&S rejected the account number / API key."
          : status ? `S&S returned HTTP ${status}.` : "Couldn't reach S&S.";
        return json({ ok: false, error: `${why} Check the key in your ssactivewear.com account and save it again.` }, 200);
      }
      const next = applySsVerified(profile.supplier_setup, acct);
      await saveSetup(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, supplier_setup: next }) });
    }

    // ── AS Colour ────────────────────────────────────────────────────
    if (action === "acRequestApi" || action === "acMarkApiRequested") {
      if (action === "acRequestApi") {
        const email = buildAcApiRequestEmail({ shopName, ownerName, ownerEmail: profile.email, accountEmail: profile.ac_email || body.accountEmail || "" });
        const sent = await sendShopEmail(profile, AC_API_EMAIL, email);
        if (!sent.ok) return json({ error: `Couldn't send the request (${sent.reason}). Try again in a minute.` }, 502);
      }
      const next = applyAcApiRequested(profile.supplier_setup);
      await saveSetup(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, supplier_setup: next }) });
    }

    if (action === "acVerify") {
      const creds = acCredsFromProfile(profile);
      if (!creds || !profile.ac_email || !profile.ac_password) {
        return json({ error: "Save all three AS Colour fields (subscription key, email, password) first." }, 400);
      }
      const bearer = await getAcBearerToken(creds, true);
      if (!bearer) {
        return json({ ok: false, error: "AS Colour rejected the subscription key or the email/password. Check them and save again." }, 200);
      }
      const next = applyAcVerified(profile.supplier_setup);
      await saveSetup(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, supplier_setup: next }) });
    }

    if (action === "acRequestCredit" || action === "acMarkCreditRequested") {
      if (action === "acRequestCredit") {
        const email = buildAcCreditRequestEmail({ shopName, ownerName, ownerEmail: profile.email, accountEmail: profile.ac_email || "" });
        const sent = await sendShopEmail(profile, AC_SUPPORT_EMAIL, email);
        if (!sent.ok) return json({ error: `Couldn't send the request (${sent.reason}). Try again in a minute.` }, 502);
      }
      const next = applyAcCreditRequested(profile.supplier_setup);
      await saveSetup(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, supplier_setup: next }) });
    }

    if (action === "acMarkCreditApproved" || action === "acUnmarkCreditApproved") {
      let next;
      try {
        next = applyAcCreditApproved(profile.supplier_setup, action === "acMarkCreditApproved");
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      await saveSetup(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, supplier_setup: next }) });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[supplierSetup] error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
