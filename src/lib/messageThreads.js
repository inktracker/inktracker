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

// Adds [Ref: <id>] to a subject line if it isn't already there.
// Customer replies typically prefix with "Re: " — the ref tag survives that.
export function addRefTag(subject, refId) {
  if (!subject || !refId) return subject || "";
  if (subject.includes(`[Ref: ${refId}]`)) return subject;
  return `${subject} [Ref: ${refId}]`;
}

// Pulls the ref id out of an inbound subject so we can route to the right thread.
const REF_RE = /\[Ref:\s*([A-Z0-9-]+)\]/i;
export function parseRefTag(subject) {
  const match = REF_RE.exec(subject || "");
  return match ? match[1] : null;
}

// Insert a Message row recording an outbound email. Best-effort — never throws.
// Call this AFTER the email send returns success.
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
    return await base44.entities.Message.create({
      thread_id: threadId,
      from_email: fromEmail,
      from_name: fromName || fromEmail,
      to_email: toEmail || "",
      subject: subject || "",
      body: body || "",
      read: true, // outbound is always "read" from our perspective
    });
  } catch (err) {
    // Don't surface — the email already sent, the message log is bonus.
    console.warn("[messageThreads] logOutboundMessage failed:", err);
    return null;
  }
}
