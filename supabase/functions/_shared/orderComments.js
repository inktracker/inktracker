// Pure logic for the orderComments edge function — mention validation and
// notification-row building. Contract-tested in __tests__/orderComments.test.js.

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Mentions the frontend sends are just strings; only emails that belong to
// the shop's roster survive. Author can't mention themselves into a ping.
export function validateMentions(mentions, roster, authorEmail) {
  const rosterEmails = new Set((roster ?? []).map((m) => norm(m.email)).filter(Boolean));
  const author = norm(authorEmail);
  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(mentions) ? mentions : []) {
    const e = norm(m);
    if (!e || e === author || !rosterEmails.has(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export function commentSnippet(body, max = 140) {
  const s = String(body ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// One addressed notification per person who should hear about this comment:
// every validated mention, plus the shop owner (unless they wrote it or were
// already mentioned). Never the author. `orderRowId` drives the bell's
// deep-link into the order detail.
export function buildCommentNotificationRows({
  shopOwner,
  orderId,
  orderRowId,
  authorEmail,
  authorName,
  body,
  validMentions,
}) {
  const author = norm(authorEmail);
  const display = String(authorName ?? "").trim() || authorEmail;
  const snippet = commentSnippet(body);
  const recipients = new Set(validMentions ?? []);
  const owner = norm(shopOwner);
  if (owner && owner !== author) recipients.add(owner);

  const rows = [];
  for (const recipient of recipients) {
    const mentioned = (validMentions ?? []).includes(recipient);
    rows.push({
      shop_owner: shopOwner,
      recipient_email: recipient,
      event_type: "order_comment",
      severity: "info",
      title: mentioned
        ? `${display} mentioned you on ${orderId}`
        : `${display} commented on ${orderId}`,
      body: snippet,
      related_entity: "order",
      related_id: orderRowId || null,
      metadata: { order_id: orderId, author_email: authorEmail, mentioned },
    });
  }
  return rows;
}
