// Helpers for the per-job Messages thread.
//
// thread_id format: "{type}:{external_id}"
//   "quote:Q-2026-115"   "order:ORD-2026-077"   "invoice:INV-2026-014"
//
// These helpers also handle the [Ref: ...] subject tag used so that customer
// replies can be matched back to the right thread by emailScanner (PR2).

import { base44 } from "@/api/supabaseClient";

export function quoteThreadId(quoteOrId) {
  const id = typeof quoteOrId === "string" ? quoteOrId : quoteOrId?.quote_id;
  return id ? `quote:${id}` : null;
}

export function orderThreadId(orderOrId) {
  const id = typeof orderOrId === "string" ? orderOrId : orderOrId?.order_id;
  return id ? `order:${id}` : null;
}

export function invoiceThreadId(invoiceOrId) {
  const id = typeof invoiceOrId === "string" ? invoiceOrId : invoiceOrId?.invoice_id;
  return id ? `invoice:${id}` : null;
}

// Deterministic 4-character shop code derived from the shop owner's email.
// Used to namespace [Ref:] tags across shops so the customer-facing token is
// globally unique. Pure synchronous FNV-1a — same algorithm runs on the edge
// function side so codes computed in either environment match.
export function shopCodeFor(email) {
  if (!email) return "0000";
  const lower = String(email).toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < lower.length; i++) {
    h ^= lower.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  // 4 chars of base36 — 1.6M values. Collision risk is irrelevant because
  // resolveRef on the inbound side ALSO scopes by shop_owner = profile.email,
  // so the worst case from a hash collision is a tag that gets ignored.
  return h.toString(36).padStart(4, "0").slice(-4);
}

// Adds a globally-unique [Ref: <code>-<id>] tag to a subject line.
// `shopOwnerEmail` is optional for backwards compatibility — when omitted,
// the legacy `[Ref: <id>]` format is used and inbound parsing still accepts it.
export function addRefTag(subject, refId, shopOwnerEmail) {
  if (!subject || !refId) return subject || "";
  const code = shopOwnerEmail ? shopCodeFor(shopOwnerEmail) : null;
  const tagBody = code ? `${code}-${refId}` : refId;
  const tag = `[Ref: ${tagBody}]`;
  if (subject.includes(tag)) return subject;
  // Also detect legacy format already present so we don't double-tag.
  if (!code && subject.includes(`[Ref: ${refId}]`)) return subject;
  return `${subject} ${tag}`;
}

// Pulls the ref id out of an inbound subject so we can route to the right thread.
// Returns { shopCode, refId } where shopCode is null for legacy tags.
//
// Format examples:
//   [Ref: a3f7-Q-2026-115]   → { shopCode: "a3f7", refId: "Q-2026-115" }
//   [Ref: Q-2026-115]        → { shopCode: null,   refId: "Q-2026-115" }   (legacy)
const REF_RE = /\[Ref:\s*(?:([a-z0-9]{4})-)?([A-Z0-9][A-Z0-9-]*)\]/i;
export function parseRefTag(subject) {
  const match = REF_RE.exec(subject || "");
  if (!match) return null;
  return { shopCode: match[1] || null, refId: match[2] };
}

// Insert a Message row recording an outbound email. Best-effort — never throws.
// Call this AFTER the email send returns success.
//
// Note: the existing `messages` table (shared with BrokerMessaging) doesn't
// have a `subject` column. We fold the subject into the body so we don't lose
// it, and MessagesTab parses it back out at display time.
export async function logOutboundMessage({
  threadId,
  fromEmail,
  fromName,
  toEmail,
  subject,
  body,
}) {
  if (!threadId || !fromEmail) return null;
  try {
    const composedBody = subject
      ? `Subject: ${subject}\n\n${body || ""}`
      : (body || "");
    return await base44.entities.Message.create({
      thread_id: threadId,
      from_email: fromEmail,
      from_name: fromName || fromEmail,
      to_email: toEmail || "",
      body: composedBody,
      read: true, // outbound is always "read" from our perspective
    });
  } catch (err) {
    // Don't surface — the email already sent, the message log is bonus.
    console.warn("[messageThreads] logOutboundMessage failed:", err);
    return null;
  }
}

// Splits a body that starts with "Subject: ..." back into { subject, body }.
// Strips dedup markers like [GmailID:...] from the body before returning.
// Tolerant: returns { subject: null, body } if no subject prefix is present.
export function parseStoredBody(stored) {
  if (!stored) return { subject: null, body: "" };
  // Drop hidden dedup markers used by emailScanner to avoid double-ingestion.
  const cleaned = stored.replace(/\n*\[GmailID:[^\]]+\]\s*$/, "").replace(/\n*\[Mid:[^\]]+\]\s*$/, "");
  const match = /^Subject:\s*(.+?)\n\n([\s\S]*)$/.exec(cleaned);
  if (match) return { subject: match[1].trim(), body: match[2].trim() };
  return { subject: null, body: cleaned };
}

// Internal notes: tagged inline in the body so we don't need a new column.
// MessagesTab strips this on display.
export const INTERNAL_PREFIX = "[INTERNAL]\n\n";

export function isInternalBody(stored) {
  return typeof stored === "string" && stored.startsWith(INTERNAL_PREFIX);
}

export function stripInternalPrefix(stored) {
  if (!stored) return "";
  return stored.startsWith(INTERNAL_PREFIX) ? stored.slice(INTERNAL_PREFIX.length) : stored;
}
