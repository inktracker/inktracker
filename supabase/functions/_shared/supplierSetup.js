import { escapeHtml as esc } from "./emailSanitize.js";
// S&S Activewear + AS Colour in-app setup — PURE logic shared by the
// supplierSetup edge function (Deno) and the frontend/tests (Node). Sibling
// of sanmarOnboarding.js. No I/O here.
//
// Unlike SanMar, neither supplier gates ORDERING behind a supplier-run test:
//   S&S       — the shop generates an API key itself in its ssactivewear.com
//               account, pastes account # + key, and we VERIFY with a real
//               authenticated call. Done.
//   AS Colour — API credentials come from AS Colour (api@ascolour.com); we
//               send that request for the shop. After the three fields are
//               saved we VERIFY by minting a bearer token (proves key + email +
//               password together). Orders additionally need approved CREDIT
//               TERMS (AS Colour's only API payment option, 2–4 weeks) — we
//               send the credit-application request for the shop and track
//               approval; without terms orders still submit but sit in
//               "awaiting payment" at AS Colour.

export const AC_API_EMAIL = "api@ascolour.com";
export const AC_SUPPORT_EMAIL = "support@ascolour.com";
export const SS_API_KEY_URL = "https://www.ssactivewear.com/";

export function normalizeSupplierSetup(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const ss = o.ss && typeof o.ss === "object" ? o.ss : {};
  const ac = o.ac && typeof o.ac === "object" ? o.ac : {};
  return {
    ss: {
      verified_at: ss.verified_at || null,
      verified_account: ss.verified_account || null,
    },
    ac: {
      api_requested_at: ac.api_requested_at || null,
      verified_at: ac.verified_at || null,
      credit_requested_at: ac.credit_requested_at || null,
      credit_approved_at: ac.credit_approved_at || null,
    },
  };
}

// ── S&S: 1 get key → 2 enter → 3 verified ─────────────────────────────────
export function ssStep(raw, flags = {}) {
  const s = normalizeSupplierSetup(raw).ss;
  if (s.verified_at && flags.ss) return 4; // done
  if (flags.ss) return 3;
  return 1; // steps 1+2 are shown together (get key, paste it)
}

export function applySsVerified(raw, accountNumber, now = new Date().toISOString()) {
  const o = normalizeSupplierSetup(raw);
  return { ...o, ss: { verified_at: now, verified_account: String(accountNumber || "") } };
}

export function applySsCleared(raw) {
  const o = normalizeSupplierSetup(raw);
  return { ...o, ss: { verified_at: null, verified_account: null } };
}

// ── AS Colour: 1 request API creds → 2 enter → 3 verified → 4 credit
// application → 5 credit approved ───────────────────────────────────────
export function acStep(raw, flags = {}) {
  const a = normalizeSupplierSetup(raw).ac;
  const connected = !!(flags.ac && flags.ac_email && flags.ac_password);
  if (a.credit_approved_at && a.verified_at && connected) return 6; // done
  if (a.verified_at && connected) return a.credit_requested_at ? 5 : 4;
  if (connected) return 3;
  if (a.api_requested_at) return 2;
  return 1;
}

export function applyAcApiRequested(raw, now = new Date().toISOString()) {
  const o = normalizeSupplierSetup(raw);
  return { ...o, ac: { ...o.ac, api_requested_at: o.ac.api_requested_at || now } };
}

export function applyAcVerified(raw, now = new Date().toISOString()) {
  const o = normalizeSupplierSetup(raw);
  return { ...o, ac: { ...o.ac, verified_at: now } };
}

export function applyAcCleared(raw) {
  const o = normalizeSupplierSetup(raw);
  return { ...o, ac: { ...o.ac, verified_at: null } };
}

export function applyAcCreditRequested(raw, now = new Date().toISOString()) {
  const o = normalizeSupplierSetup(raw);
  return { ...o, ac: { ...o.ac, credit_requested_at: o.ac.credit_requested_at || now } };
}

export function applyAcCreditApproved(raw, approved, now = new Date().toISOString()) {
  const o = normalizeSupplierSetup(raw);
  if (approved && !o.ac.verified_at) throw new Error("Verify your AS Colour connection before marking credit terms approved.");
  return { ...o, ac: { ...o.ac, credit_requested_at: o.ac.credit_requested_at || (approved ? now : null), credit_approved_at: approved ? now : null } };
}
function toHtml(lines) {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines.map((l) => (l ? `<p style="margin:0 0 6px">${esc(l)}</p>` : `<p style="margin:0 0 6px">&nbsp;</p>`)).join("")}</div>`;
}

/** AS Colour step 1 — ask for API credentials for the shop's account. */
export function buildAcApiRequestEmail({ shopName, ownerName, ownerEmail, accountEmail }) {
  const acct = accountEmail || ownerEmail;
  const subject = `API access request — ${shopName} (AS Colour account ${acct})`;
  const lines = [
    `Hello AS Colour API team,`,
    ``,
    `${shopName} manages its shop with InkTracker (https://www.inktracker.app), which integrates with the AS Colour API for live catalog, pricing, inventory, and order placement.`,
    ``,
    `Please issue API credentials (subscription key) for our AS Colour account. The account login email is ${acct}.`,
    ``,
    `Please reply to ${ownerEmail}.`,
    ``,
    `Thank you,`,
    `${ownerName || shopName}`,
    `${shopName}`,
  ];
  return { subject, text: lines.join("\n"), html: toHtml(lines) };
}

/** AS Colour step 4 — request the credit application (needed for API orders). */
export function buildAcCreditRequestEmail({ shopName, ownerName, ownerEmail, accountEmail }) {
  const acct = accountEmail || ownerEmail;
  const subject = `Credit application request — ${shopName} (AS Colour account ${acct})`;
  const lines = [
    `Hello AS Colour,`,
    ``,
    `${shopName} places orders through the AS Colour API (via InkTracker) and would like to apply for credit terms so API orders can be processed on account.`,
    ``,
    `Please send the credit application for our account (login email ${acct}). We'll complete and return it promptly and can supply credit references on request.`,
    ``,
    `Please reply to ${ownerEmail}.`,
    ``,
    `Thank you,`,
    `${ownerName || shopName}`,
    `${shopName}`,
  ];
  return { subject, text: lines.join("\n"), html: toHtml(lines) };
}
