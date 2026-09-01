// Pure logic for the statusCustomerEmail edge function. Contract-tested in
// __tests__/statusCustomerEmail.test.js.

// Customer-facing phrasing per pipeline status. Only statuses here can
// ever email a customer, no matter what the config claims.
export const STATUS_PHRASES = {
  "Printing":  { phrase: "is now in production", subjectBit: "in production" },
  "Completed": { phrase: "is finished",          subjectBit: "ready" },
  "Shipped":   { phrase: "is on its way",        subjectBit: "shipped" },
};

/**
 * Decide whether this transition emails the customer.
 * Returns { send: false, reason } or { send: true, phrase, subjectBit, note }.
 */
export function decideStatusEmail({ order, config, toStatus }) {
  const known = STATUS_PHRASES[toStatus];
  if (!known) return { send: false, reason: "status_not_customer_facing" };
  const entry = config?.[toStatus];
  if (!entry?.enabled) return { send: false, reason: "not_enabled" };
  if (order?.broker_id) return { send: false, reason: "broker_order" };
  const email = String(order?.customer_email ?? "").trim();
  if (!email || !email.includes("@")) return { send: false, reason: "no_customer_email" };
  return {
    send: true,
    phrase: known.phrase,
    subjectBit: known.subjectBit,
    note: String(entry?.note ?? "").trim().slice(0, 500),
  };
}

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildStatusEmailSubject({ shopName, orderId, subjectBit }) {
  return `${shopName || "Your print shop"}: order ${orderId} is ${subjectBit}`;
}

export function buildStatusEmailHtml({ shopName, customerName, orderId, phrase, note, statusUrl }) {
  const first = String(customerName ?? "").trim().split(/\s+/)[0] || "there";
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px 16px">
  <h2 style="margin:0 0 16px">${esc(shopName || "Your print shop")}</h2>
  <p>Hi ${esc(first)},</p>
  <p>Your order <strong>${esc(orderId)}</strong> ${esc(phrase)}.</p>
  ${note ? `<p style="background:#f8fafc;border-left:3px solid #0d9488;padding:8px 12px">${esc(note)}</p>` : ""}
  ${statusUrl ? `<p><a href="${esc(statusUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">View order status</a></p>` : ""}
  <p style="color:#64748b;font-size:13px">Reply to this email to reach us.</p>
</body></html>`;
}
