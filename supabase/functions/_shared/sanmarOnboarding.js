import { escapeHtml as esc } from "./emailSanitize.js";
// SanMar PO-integration onboarding — PURE logic shared by the smOnboarding
// edge function (Deno) and the frontend/tests (Node). No I/O here.
//
// The flow mirrors SanMar's Purchase Order Integration Guide v24.5 pp.3–4,
// 11–14 ("Purchase Order Integration Onboarding steps"):
//   1. request  — shop emails sanmarintegrations@sanmar.com asking for PO
//                 integration (we send it for them).
//   2. edev     — SanMar replies (2–3 business days) with a one-time link to
//                 EDEV test credentials; the shop pastes them in.
//   3. test     — shop submits a multi-line test PO on EDEV to the address it
//                 will ship to in production (one per ship method it wants).
//   4. notify   — we email SanMar the test PO number(s) + the production
//                 setup answers (shipping option, PSST, notification email,
//                 label company name, username, payment method).
//   5. live     — SanMar validates the order files and configures production
//                 (1–2 business days); the shop confirms and ordering turns on.
//
// Decisions baked in (Joe, 2026-09-15): Integrated Ordering Shipping Option =
// Option 1 "Warehouse Consolidation" (SanMar's default, no extra validation,
// best for free-freight pooling); PSST is NOT used (written confirmation so
// SanMar bypasses the PSST test); warehouse selection is NOT requested.

export const SANMAR_INTEGRATIONS_EMAIL = "sanmarintegrations@sanmar.com";

export const ONBOARDING_STATUSES = [
  "not_started",
  "requested",
  "edev_ready",
  "tested",
  "awaiting_sanmar",
  "live",
];

export const SHIPPING_OPTION_LABEL = "Option 1 — Warehouse Consolidation (default)";

// SanMar's recommended EDEV test products (guide v24.5 p.13). Four lines by
// default: SanMar validates formatting on MULTI-line orders.
export const DEFAULT_TEST_LINES = [
  { style: "PC61", color: "Charcoal", size: "L", quantity: 12 },
  { style: "PC61", color: "White", size: "M", quantity: 6 },
  { style: "PC55", color: "Kelly", size: "M", quantity: 6 },
  { style: "K500", color: "Black", size: "L", quantity: 3 },
];

export function normalizeOnboarding(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const status = ONBOARDING_STATUSES.includes(o.status) ? o.status : "not_started";
  return {
    status,
    requested_at: o.requested_at || null,
    edev_saved_at: o.edev_saved_at || null,
    tests: Array.isArray(o.tests) ? o.tests : [],
    notified_at: o.notified_at || null,
    payment_method: o.payment_method || "",
    live_at: o.live_at || null,
  };
}

export function isSanmarPoLive(raw) {
  return normalizeOnboarding(raw).status === "live";
}

// Which step number (1–5) the shop is on, for the stepper UI.
export function currentStep(raw) {
  const s = normalizeOnboarding(raw).status;
  switch (s) {
    case "not_started": return 1;
    case "requested": return 2;
    case "edev_ready": return 3;
    case "tested": return 4;
    case "awaiting_sanmar": return 5;
    case "live": return 6; // done
    default: return 1;
  }
}

// PO number for a test order: "<SHOP>-TEST-<n>", ≤ 28 chars, no commas
// (SanMar's order-file delimiter), alnum + dash only.
export function testPoNumber(shopName, n) {
  const base = String(shopName || "SHOP").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "SHOP";
  return `${base}-TEST-${Math.max(1, Number(n) || 1)}`.slice(0, 28);
}

// Ship-to for the test order, from the shop profile — SanMar requires the
// address the shop will use in PRODUCTION. Returns { shipTo } or { error }.
export function testShipToFromProfile(profile) {
  const p = profile || {};
  const name = (p.company_name || p.shop_name || "").trim();
  const address1 = (p.address || "").trim();
  const city = (p.city || "").trim();
  const state = (p.state || "").trim();
  const zip = (p.zip || "").trim();
  const email = (p.email || "").trim();
  const missing = [];
  if (!name) missing.push("shop name");
  if (!address1) missing.push("street address");
  if (!city) missing.push("city");
  if (!state) missing.push("state");
  if (!zip) missing.push("ZIP");
  if (missing.length) {
    return { error: `Add your shop's ${missing.join(", ")} under Account → Business details first — SanMar ships test and production orders to that address.` };
  }
  return { shipTo: { name, address1, address2: "", city, state, zip, email, residence: false } };
}

function addressLine(shipTo) {
  const s = shipTo || {};
  return [s.name, s.address1, s.address2, `${s.city || ""} ${s.state || ""} ${s.zip || ""}`.trim()].filter(Boolean).join(", ");
}

/**
 * Step 1 email — ask SanMar Integration Support to set the account up for
 * PO integration testing. Sent FROM InkTracker with reply-to + cc the shop,
 * so SanMar's reply (with the one-time EDEV credential link) lands with the
 * shop, never with us.
 */
export function buildRequestEmail({ customerNumber, username, shopName, ownerName, ownerEmail, shipTo }) {
  const subject = `PO integration request — SanMar customer ${customerNumber} (${shopName})`;
  const lines = [
    `Hello SanMar Integration Support,`,
    ``,
    `${shopName} (SanMar customer #${customerNumber}, sanmar.com username "${username}") manages its shop with InkTracker (https://www.inktracker.app), which places purchase orders through your Standard Web Services PO service (submitPO / getPreSubmitInfo). Web Services product-data access is already active on this account.`,
    ``,
    `Please set us up for Purchase Order integration testing: an EDEV environment account with Web Services credentials (one-time access link to ${ownerEmail}).`,
    ``,
    `Details for testing and production:`,
    `- Ship-to address (same in production): ${addressLine(shipTo)}`,
    `- Integrated Ordering Shipping Option: ${SHIPPING_OPTION_LABEL}`,
    `- PSST: we do not plan to use the PSST ship method — please bypass the PSST test (this is our written confirmation).`,
    `- Warehouse selection: not requested.`,
    ``,
    `Please reply to ${ownerEmail}.`,
    ``,
    `Thank you,`,
    `${ownerName || shopName}`,
    `${shopName}`,
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines.map((l) => (l ? `<p style="margin:0 0 6px">${esc(l)}</p>` : `<p style="margin:0 0 6px">&nbsp;</p>`)).join("")}</div>`;
  return { subject, text, html };
}

/**
 * Step 4 email — hand SanMar the EDEV test PO number(s) for validation plus
 * the production setup answers they ask for (guide p.12/p.14), so they can
 * configure the production account without a second round-trip.
 */
export function buildNotifyEmail({ customerNumber, username, shopName, ownerEmail, shipTo, tests, paymentMethod }) {
  const done = (tests || []).filter((t) => t && t.po_number);
  const poList = done.map((t) => `${t.po_number} (ship method ${t.ship_method || "UPS"})`).join(", ");
  const subject = `EDEV test PO submitted — SanMar customer ${customerNumber}: ${done.map((t) => t.po_number).join(", ")}`;
  const lines = [
    `Hello SanMar Integration Support,`,
    ``,
    `${shopName} (customer #${customerNumber}) has submitted the following EDEV test purchase order${done.length === 1 ? "" : "s"} via the Standard Web Services submitPO service: ${poList}.`,
    `Please review the order files and let us know if anything needs adjusting.`,
    ``,
    `Production setup information:`,
    `- SanMar account number: ${customerNumber}`,
    `- sanmar.com username: ${username}`,
    `- Shipping notification email: ${ownerEmail}`,
    `- Shipping label company name: ${shipTo?.name || shopName}`,
    `- Ship-to address: ${addressLine(shipTo)}`,
    `- Integrated Ordering Shipping Option: ${SHIPPING_OPTION_LABEL}`,
    `- PSST: not used — please bypass the PSST test (written confirmation).`,
    `- Payment method: ${paymentMethod || "(on file — please confirm with us)"}`,
    ``,
    `Once validated, please enable integrated PO processing on the production account and confirm the go-live date. Reply to ${ownerEmail}.`,
    ``,
    `Thank you,`,
    `${shopName}`,
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines.map((l) => (l ? `<p style="margin:0 0 6px">${esc(l)}</p>` : `<p style="margin:0 0 6px">&nbsp;</p>`)).join("")}</div>`;
  return { subject, text, html };
}

// State transitions — each returns the NEW onboarding object or throws with a
// user-facing message. Keeps the edge function thin and the rules testable.
export function applyRequested(raw, now = new Date().toISOString()) {
  const o = normalizeOnboarding(raw);
  if (o.status === "live") throw new Error("SanMar ordering is already live for this shop.");
  return { ...o, status: o.status === "not_started" ? "requested" : o.status, requested_at: o.requested_at || now };
}

export function applyEdevSaved(raw, now = new Date().toISOString()) {
  const o = normalizeOnboarding(raw);
  if (o.status === "live") return { ...o, edev_saved_at: now };
  const status = ["not_started", "requested"].includes(o.status) ? "edev_ready" : o.status;
  return { ...o, status, requested_at: o.requested_at || now, edev_saved_at: now };
}

export function applyTestSubmitted(raw, test, now = new Date().toISOString()) {
  const o = normalizeOnboarding(raw);
  if (!test || !test.po_number) throw new Error("Test result is missing a PO number.");
  const tests = [...o.tests, { ...test, submitted_at: test.submitted_at || now }];
  const status = ["edev_ready", "tested"].includes(o.status) ? "tested" : o.status === "awaiting_sanmar" ? "awaiting_sanmar" : o.status;
  if (status === "not_started" || status === "requested") throw new Error("Save your EDEV test credentials first.");
  return { ...o, status, tests };
}

export function applyNotified(raw, paymentMethod, now = new Date().toISOString()) {
  const o = normalizeOnboarding(raw);
  if (!o.tests.some((t) => t && t.po_number && t.result && t.result.success)) {
    throw new Error("Submit a successful EDEV test order before telling SanMar.");
  }
  return { ...o, status: o.status === "live" ? "live" : "awaiting_sanmar", notified_at: now, payment_method: String(paymentMethod || "").trim() };
}

export function applyLive(raw, now = new Date().toISOString()) {
  const o = normalizeOnboarding(raw);
  if (o.status !== "awaiting_sanmar" && o.status !== "tested") {
    throw new Error("Tell SanMar about your test order first — they enable production after validating it.");
  }
  return { ...o, status: "live", live_at: now };
}

export function applyNotLive(raw) {
  const o = normalizeOnboarding(raw);
  if (o.status !== "live") return o;
  return { ...o, status: "awaiting_sanmar", live_at: null };
}
