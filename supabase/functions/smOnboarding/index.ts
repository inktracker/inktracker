// SanMar PO-integration onboarding — Supabase Edge Function
//
// Walks a shop through SanMar's per-account PO integration onboarding from
// inside InkTracker (Account → Suppliers → SanMar), so the shop never has to
// read the PDF guide, write to SanMar, or run a script:
//
//   status         → current progress + what's needed for the next step
//   requestAccess  → emails sanmarintegrations@sanmar.com the PO-integration
//                    request (reply-to + cc the shop owner, who receives
//                    SanMar's one-time EDEV credential link directly)
//   markRequested  → shop already emailed SanMar themselves — skip step 1
//   saveEdevCreds  → stores the EDEV username/password (profile_secrets)
//   runTestOrder   → submits a multi-line test PO on SanMar's EDEV host using
//                    the EDEV creds + the shop's production address; records
//                    resolve / stock-check / submit results
//   notifySanmar   → emails SanMar the test PO number(s) + production setup
//                    answers (shipping option, PSST bypass, notification
//                    email, label name, username, payment method)
//   markLive       → shop confirms SanMar's go-live email → ordering on
//   markNotLive    → back off (e.g. SanMar asked for another test)
//
// Only status = 'live' (profiles.sanmar_po_onboarding) lets smPlaceOrder post
// a REAL order for this shop. Nothing here ever touches the production host:
// the test order is hard-wired to SM_TEST_BASE (edev-ws.sanmar.com) and the
// EDEV credentials, which are useless against production.
//
// Auth: signed-in owner/manager (canPlaceOrder role gate — brokers/employees
// refused); acts on the SHOP OWNER's profile (loadShopProfileForUser).

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  CORS,
  SM_TEST_BASE,
  SM_PO_SPEC,
  buildPreSubmitInfoEnvelope,
  buildSubmitPoEnvelope,
  parsePreSubmitInfoResponse,
  parseSubmitPoResponse,
  resolveSmPoLines,
  normalizeSmShipMethod,
  SM_SHIP_METHODS,
  smSoapCall,
  type SmCreds,
  type SmPoLine,
} from "../_shared/sanmar.ts";
import { canPlaceOrder } from "../_shared/acOrderLogic.js";
import { loadShopProfileForUser, loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { sendResendEmail } from "../_shared/resendClient.js";
import {
  SANMAR_INTEGRATIONS_EMAIL,
  DEFAULT_TEST_LINES,
  normalizeOnboarding,
  testPoNumber,
  testShipToFromProfile,
  buildRequestEmail,
  buildNotifyEmail,
  applyRequested,
  applyEdevSaved,
  applyTestSubmitted,
  applyNotified,
  applyLive,
  applyNotLive,
} from "../_shared/sanmarOnboarding.js";

const SEND_FROM = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

// deno-lint-ignore no-explicit-any
type AnyProfile = Record<string, any>;

// deno-lint-ignore no-explicit-any
async function saveOnboarding(admin: any, profileId: string, onboarding: unknown) {
  const { error } = await admin.from("profiles").update({ sanmar_po_onboarding: onboarding }).eq("id", profileId);
  if (error) throw new Error(`Couldn't save onboarding progress: ${error.message}`);
}

function statusPayload(profile: AnyProfile) {
  const onboarding = normalizeOnboarding(profile.sanmar_po_onboarding);
  const shipTo = testShipToFromProfile(profile);
  return {
    onboarding,
    hasSanmarCreds: Boolean(profile.sanmar_customer_number && profile.sanmar_username && profile.sanmar_password),
    hasEdevCreds: Boolean(profile.sanmar_edev_username && profile.sanmar_edev_password),
    customerNumber: profile.sanmar_customer_number || null,
    username: profile.sanmar_username || null,
    edevUsername: profile.sanmar_edev_username || null,
    ownerEmail: profile.email || null,
    shipTo: shipTo.shipTo || null,
    shipToError: shipTo.error || null,
    shipMethods: SM_SHIP_METHODS,
    testLines: DEFAULT_TEST_LINES,
    sanmarEmail: SANMAR_INTEGRATIONS_EMAIL,
  };
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
      return json({ error: "Only the shop owner or a manager can set up SanMar ordering." }, 403);
    }
    const { profile: rawProfile } = await loadShopProfileForUser(admin, user.id);
    const profile = rawProfile as AnyProfile | null;
    if (!profile) return json({ error: "Profile not found" }, 404);

    const action = String(body.action || "status");

    if (action === "status") return json(statusPayload(profile));

    // ── Step 1: ask SanMar for PO integration + EDEV creds ───────────
    if (action === "requestAccess" || action === "markRequested") {
      if (!profile.sanmar_customer_number || !profile.sanmar_username) {
        return json({ error: "Connect your SanMar account (customer number + sanmar.com login) above first." }, 400);
      }
      const ship = testShipToFromProfile(profile);
      if (ship.error) return json({ error: ship.error }, 400);
      if (action === "requestAccess") {
        const email = buildRequestEmail({
          customerNumber: profile.sanmar_customer_number,
          username: profile.sanmar_username,
          shopName: ship.shipTo!.name,
          ownerName: profile.full_name || profile.name || "",
          ownerEmail: profile.email,
          shipTo: ship.shipTo,
        });
        const sent = await sendResendEmail({
          from: `InkTracker <${SEND_FROM}>`,
          to: [SANMAR_INTEGRATIONS_EMAIL],
          cc: [profile.email],
          reply_to: profile.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
        if (!sent.ok) return json({ error: `Couldn't send the request email (${sent.reason}). Try again in a minute.` }, 502);
      }
      const next = applyRequested(profile.sanmar_po_onboarding);
      await saveOnboarding(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, sanmar_po_onboarding: next }) });
    }

    // ── Step 2: EDEV credentials ─────────────────────────────────────
    if (action === "saveEdevCreds") {
      const username = String(body.username || "").trim();
      const password = String(body.password || "").trim();
      if (!username || !password) return json({ error: "EDEV username and password are both required." }, 400);
      await updateProfileSecrets(admin, profile.id, { sanmar_edev_username: username, sanmar_edev_password: password });
      const next = applyEdevSaved(profile.sanmar_po_onboarding);
      await saveOnboarding(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, sanmar_po_onboarding: next, sanmar_edev_username: username, sanmar_edev_password: password }) });
    }

    // ── Step 3: test order on EDEV ───────────────────────────────────
    if (action === "runTestOrder") {
      if (!profile.sanmar_customer_number) return json({ error: "Connect your SanMar account above first." }, 400);
      if (!profile.sanmar_edev_username || !profile.sanmar_edev_password) {
        return json({ error: "Save your EDEV test credentials first." }, 400);
      }
      const ship = testShipToFromProfile(profile);
      if (ship.error) return json({ error: ship.error }, 400);
      const shipMethod = normalizeSmShipMethod(body.shipMethod || "UPS");
      if (!shipMethod) return json({ error: `"${body.shipMethod}" isn't a SanMar ship method.` }, 400);

      const onboarding = normalizeOnboarding(profile.sanmar_po_onboarding);
      const poNumber = testPoNumber(ship.shipTo!.name, onboarding.tests.length + 1);
      const creds: SmCreds = {
        customerNumber: String(profile.sanmar_customer_number),
        username: String(profile.sanmar_edev_username),
        password: String(profile.sanmar_edev_password),
      };
      const base = SM_TEST_BASE; // EDEV only — never production

      // Resolve keys via EDEV Product Info; fall back to style/color/size
      // (allowed by the schema) if the EDEV catalog can't resolve a line.
      const inputs = (Array.isArray(body.lines) && body.lines.length ? body.lines : DEFAULT_TEST_LINES).map((l: AnyProfile) => ({
        style: String(l.style || ""), color: String(l.color || ""), size: String(l.size || ""), quantity: Number(l.quantity) || 0,
      }));
      const { resolved, unresolved } = await resolveSmPoLines(creds, base, inputs, smSoapCall, "smOnboarding:resolve");
      let lines: SmPoLine[];
      let resolvedKeys = true;
      if (unresolved.length) {
        resolvedKeys = false;
        lines = inputs.map((l: AnyProfile) => ({ style: l.style, catalogColor: l.color, size: l.size, quantity: l.quantity }));
      } else {
        lines = resolved;
      }
      const poRequest = { poNumber, shipTo: ship.shipTo!, shipMethod, lines };

      const pre = await smSoapCall(`${base}/${SM_PO_SPEC.servicePort}`, buildPreSubmitInfoEnvelope(creds, poRequest), "smOnboarding:presubmit");
      const preParsed = pre.ok ? parsePreSubmitInfoResponse(pre.xml) : { ok: false, message: pre.error || "stock check failed", lines: [] };

      const sub = await smSoapCall(`${base}/${SM_PO_SPEC.servicePort}`, buildSubmitPoEnvelope(creds, poRequest), "smOnboarding:submit");
      const result = sub.ok ? parseSubmitPoResponse(sub.xml) : { success: false, poNumber: "", message: sub.error || "submit failed" };

      const test = {
        po_number: poNumber,
        ship_method: shipMethod,
        submitted_at: new Date().toISOString(),
        lines: inputs,
        resolved_keys: resolvedKeys,
        unresolved,
        presubmit: { ok: preParsed.ok, message: preParsed.message, lines: preParsed.lines },
        result: { success: result.success, message: result.message },
      };
      let next;
      try {
        next = applyTestSubmitted(profile.sanmar_po_onboarding, test);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      await saveOnboarding(admin, profile.id, next);
      return json({ ok: result.success, test, ...statusPayload({ ...profile, sanmar_po_onboarding: next }) });
    }

    // ── Step 4: tell SanMar ──────────────────────────────────────────
    if (action === "notifySanmar") {
      const ship = testShipToFromProfile(profile);
      if (ship.error) return json({ error: ship.error }, 400);
      let next;
      try {
        next = applyNotified(profile.sanmar_po_onboarding, body.paymentMethod);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      const email = buildNotifyEmail({
        customerNumber: profile.sanmar_customer_number,
        username: profile.sanmar_username,
        shopName: ship.shipTo!.name,
        ownerEmail: profile.email,
        shipTo: ship.shipTo,
        tests: next.tests.filter((t: AnyProfile) => t?.result?.success),
        paymentMethod: next.payment_method,
      });
      const sent = await sendResendEmail({
        from: `InkTracker <${SEND_FROM}>`,
        to: [SANMAR_INTEGRATIONS_EMAIL],
        cc: [profile.email],
        reply_to: profile.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      if (!sent.ok) return json({ error: `Couldn't send the email to SanMar (${sent.reason}). Try again in a minute.` }, 502);
      await saveOnboarding(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, sanmar_po_onboarding: next }) });
    }

    // ── Step 5: go live / back off ───────────────────────────────────
    if (action === "markLive" || action === "markNotLive") {
      let next;
      try {
        next = action === "markLive" ? applyLive(profile.sanmar_po_onboarding) : applyNotLive(profile.sanmar_po_onboarding);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
      await saveOnboarding(admin, profile.id, next);
      return json({ ok: true, ...statusPayload({ ...profile, sanmar_po_onboarding: next }) });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[smOnboarding] error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
