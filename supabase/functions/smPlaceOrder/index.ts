// SanMar place-order — Supabase Edge Function
//
// Submits a purchase order to SanMar's Standard PO SOAP web service.
//
// ⚠️  DORMANT BY DEFAULT. This function is hard-gated OFF by the
//     SANMAR_PO_ENABLED secret. Until that secret is set (to "1" or "true"),
//     it NEVER posts to SanMar — it returns { needsManual: true } so the PO
//     page keeps showing the "order directly, then Mark submitted" path. The
//     gate exists because (a) the shop's SanMar account was not yet confirmed
//     authorized for the PO web service, and (b) the exact submitPO schema is
//     SPEC-PENDING against SanMar's WSDL (see _shared/sanmar.ts SM_PO_SPEC).
//     Flip the secret ONLY after both are settled.
//
// Body (sent by the PO page):
//   {
//     poNumber: string,                 // shop's PO reference
//     shipTo: { name, address1, address2, city, state, zip, country, phone, email },
//     shippingMethod?: string,
//     notes?: string,
//     lines: [{ style, color, size, qty }],   // resolved to inventoryKey+sizeIndex here
//     idempotencyKey: string,           // the PO's UUID
//     accessToken?: string,             // also accepted via Authorization header
//   }
//
// Auth required. Uses the caller's per-shop SanMar credentials (no env
// fallback — order placement commits real money). Brokers/employees refused.

import {
  CORS,
  credsFromProfile,
  buildProductInfoEnvelope,
  parseProductInfoResponse,
  buildSubmitPoEnvelope,
  parseSubmitPoResponse,
  smBase,
  smSoapCall,
  SM_PO_SPEC,
  type SmCreds,
  type SmPoLine,
} from "../_shared/sanmar.ts";
import { canPlaceOrder } from "../_shared/acOrderLogic.js";
import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { loadShopProfileForUser, loadProfileWithSecrets } from "../_shared/profileSecrets.ts";
import { requireActiveTeamSubscription } from "../_shared/subscriptionGuard.ts";
import { claimSupplierOrder, finishSupplierOrder } from "../_shared/supplierIdempotency.js";

// The manual-fallback response the PO page understands: nothing was sent to
// SanMar, keep the "place it directly, then Mark submitted" flow.
const MANUAL = {
  needsManual: true,
  message:
    "SanMar orders aren't being placed through InkTracker yet — order it directly with SanMar, then use “Mark submitted”.",
};

function poEnabled(): boolean {
  const flag = (Deno.env.get("SANMAR_PO_ENABLED") || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

// STRICT per-shop creds — order placement charges a real SanMar account, so
// unlike lookups this refuses the platform env fallback (same posture as
// acPlaceOrder). All three secrets must be present on the shop profile.
function strictShopCreds(profile: {
  sanmar_customer_number?: string | null;
  sanmar_username?: string | null;
  sanmar_password?: string | null;
} | null): SmCreds | null {
  const num = profile?.sanmar_customer_number || "";
  const user = profile?.sanmar_username || "";
  const pass = profile?.sanmar_password || "";
  if (num && user && pass) return { customerNumber: num, username: user, password: pass };
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Auth required ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { accessToken: bodyToken } = body;
    const headerToken = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    const token = bodyToken || headerToken;
    if (!token) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser(token);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Role gate on the SIGNED-IN user's profile (not the resolved shop owner) —
    // brokers/employees must never place real-money supplier orders.
    const callerProfile = await loadProfileWithSecrets(admin, { auth_id: user.id });
    if (!canPlaceOrder(callerProfile)) {
      return Response.json(
        { error: "Your account role can't place supplier orders. Ask your shop owner or manager." },
        { status: 403, headers: CORS },
      );
    }

    const { profile } = await loadShopProfileForUser(admin, user.id);

    // Subscription gate — order placement costs real money downstream.
    const blocked = await requireActiveTeamSubscription(admin, profile);
    if (blocked) return blocked;

    // ── SAFETY GATE ──────────────────────────────────────────────────
    // Until SanMar PO submission is confirmed + verified, do NOT post to
    // SanMar. Return the manual-fallback marker AFTER auth (so an anonymous
    // caller still can't probe) but BEFORE any idempotency claim or supplier
    // POST. This is what keeps shipping this function inert.
    if (!poEnabled()) {
      console.log("[smPlaceOrder] SANMAR_PO_ENABLED not set — returning manual fallback");
      return Response.json({ success: false, ...MANUAL }, { headers: CORS });
    }

    // STRICT per-shop credentials only (no env fallback for orders).
    const creds = strictShopCreds(profile);
    if (!creds) {
      return Response.json(
        { error: "This shop has no SanMar ordering credentials configured. Add them in Account → Suppliers." },
        { status: 400, headers: CORS },
      );
    }

    // ── Validate payload ─────────────────────────────────────────────
    const { poNumber, shipTo, lines, shippingMethod = "", notes = "", idempotencyKey = "" } = body;
    if (!poNumber) return Response.json({ error: "poNumber required" }, { status: 400, headers: CORS });
    if (!shipTo?.address1 || !shipTo?.city || !shipTo?.state || !shipTo?.zip) {
      return Response.json({ error: "Complete ship-to address required" }, { status: 400, headers: CORS });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return Response.json({ error: "At least one order line required" }, { status: 400, headers: CORS });
    }

    // ── Idempotency claim ────────────────────────────────────────────
    // Key = the PO's stable UUID so a double-submit can't place a second
    // real order. Required — refuse rather than risk a duplicate purchase.
    const shopOwner = (profile?.email || user.email || "") as string;
    const idemKey = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
    if (!idemKey) return Response.json({ error: "idempotencyKey is required." }, { status: 400, headers: CORS });

    let claim;
    try {
      claim = await claimSupplierOrder(admin, { shopOwner, key: idemKey, supplier: "SanMar" });
    } catch (e) {
      console.error("[smPlaceOrder] idempotency claim failed:", e instanceof Error ? e.message : String(e));
      return Response.json({ error: "Couldn't verify this order isn't a duplicate. Please try again." }, { status: 503, headers: CORS });
    }
    if (claim.replay) {
      return Response.json({ success: true, order: claim.response?.order ?? claim.response, idempotentReplay: true }, { headers: CORS });
    }
    if (claim.inFlight) {
      return Response.json({ error: "This order is already being placed. Please wait a moment." }, { status: 409, headers: CORS });
    }
    const recordOutcome = (success: boolean, response: unknown, supplierOrderId?: string | null) =>
      finishSupplierOrder(admin, { shopOwner, key: idemKey, success, response, supplierOrderId });

    // ── Resolve each line to inventoryKey + sizeIndex ────────────────
    // SanMar orders by inventoryKey + sizeIndex, not human style/color/size.
    // Look each style up once (getProductInfoByStyleColorSize returns a row
    // per color×size with both keys), then match on color name + size.
    const base = smBase();
    const infoCache: Record<string, Awaited<ReturnType<typeof parseProductInfoResponse>>> = {};
    const resolved: SmPoLine[] = [];
    const unresolved: string[] = [];

    for (const l of lines) {
      const style = String(l.style || "").trim();
      const color = String(l.color || "").trim();
      const size = String(l.size || "").trim();
      const qty = Number(l.qty ?? l.quantity) || 0;
      if (!style || qty <= 0) {
        unresolved.push(`${style || "?"} ${color} ${size}`.trim());
        continue;
      }
      // Cache by style+color, NOT style alone: the Product Info SOAP query is
      // color-filtered, so a second line of the same style in a DIFFERENT color
      // would hit a cache holding only the first color's rows and falsely fail.
      const infoKey = `${style}::${color.toUpperCase()}`;
      if (!infoCache[infoKey]) {
        const res = await smSoapCall(
          `${base}/SanMarProductInfoServicePort`,
          buildProductInfoEnvelope(creds, style, color),
          "smPlaceOrder:info",
        );
        infoCache[infoKey] = res.ok ? parseProductInfoResponse(res.xml) : [];
      }
      const rows = infoCache[infoKey];
      const match = rows.find(
        (r) =>
          r.size.toUpperCase() === size.toUpperCase() &&
          (r.color.toUpperCase() === color.toUpperCase() ||
            r.catalogColor.toUpperCase() === color.toUpperCase()),
      );
      if (match?.inventoryKey && match?.sizeIndex) {
        resolved.push({
          inventoryKey: match.inventoryKey,
          sizeIndex: match.sizeIndex,
          style,
          catalogColor: match.catalogColor,
          size,
          quantity: qty,
        });
      } else {
        unresolved.push(`${style} ${color} ${size}`.trim());
      }
    }

    // Never place a partial real order silently — if any line couldn't be
    // resolved to a SanMar variant, refuse the whole thing and release the
    // idempotency key so the operator can fix it.
    if (unresolved.length > 0) {
      await recordOutcome(false, { unresolved });
      return Response.json(
        {
          error:
            `Couldn't match ${unresolved.length} line(s) to a SanMar variant: ${unresolved.join(", ")}. ` +
            `Check the style, color, and size, or order those directly.`,
        },
        { status: 422, headers: CORS },
      );
    }

    // ── Submit ───────────────────────────────────────────────────────
    // Don't log ship-to PII.
    console.log(`[smPlaceOrder] submitting PO ${poNumber} — ${resolved.length} line(s) via ${SM_PO_SPEC.operation}`);
    const res = await smSoapCall(
      `${base}/${SM_PO_SPEC.servicePort}`,
      buildSubmitPoEnvelope(creds, {
        poNumber: String(poNumber),
        shipTo,
        shipMethod: String(shippingMethod || ""),
        notes: String(notes || ""),
        lines: resolved,
      }),
      "smPlaceOrder:submit",
    );

    if (!res.ok) {
      console.error("[smPlaceOrder] SanMar rejected:", res.error);
      await recordOutcome(false, { error: res.error, xml: res.xml?.slice(0, 500) });
      return Response.json({ error: `SanMar order failed: ${res.error || "unknown error"}` }, { status: 502, headers: CORS });
    }

    const parsed = parseSubmitPoResponse(res.xml);
    if (!parsed.success) {
      await recordOutcome(false, { message: parsed.message, xml: res.xml?.slice(0, 500) });
      return Response.json({ error: parsed.message || "SanMar rejected the order" }, { status: 502, headers: CORS });
    }

    const supplierOrderId = parsed.poNumber || String(poNumber);
    await recordOutcome(true, { order: { poNumber: parsed.poNumber, message: parsed.message } }, supplierOrderId);
    return Response.json(
      { success: true, order: { poNumber: parsed.poNumber || String(poNumber), message: parsed.message } },
      { headers: CORS },
    );
  } catch (err) {
    console.error("smPlaceOrder error:", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: CORS });
  }
});
