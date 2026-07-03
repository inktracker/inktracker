import { sendResendEmail } from "./resendClient.js";

// Email notifications fired when a client approves something via the
// public links (quote-approval, artwork-approval). Reaches the shop
// owner OR the broker depending on the quote shape, so the right
// person gets a heads-up to take the next action.
//
// Pure builders + a thin Resend wrapper. The builders are testable
// without spinning up Deno or hitting Resend. The send function is
// best-effort: a failure here MUST NOT roll back the approval write
// the caller already committed.

// Use the SAME verified Resend sender that sendQuoteEmail uses. The
// previous default (notifications@inktracker.app) wasn't set up in
// Resend's verified-senders list, so every send silently rejected
// — and the best-effort try/catch around sendApprovalNotification
// hid the failure from operators (we logged to console.error but
// nothing user-visible). The 2026-05-31 "approval emails not
// arriving" report.
//
// The Resend-verified sending domain is info.inktracker.app — NOT the
// root domain. This default previously pointed at quotes@inktracker.app
// (root), and because APPROVAL_SEND_FROM was never set, every approval /
// payment notification 403'd silently from June 1 to July 2, 2026. Any
// future sender address must be added in Resend's dashboard before being
// used here.
const SEND_FROM_DEFAULT = "quotes@info.inktracker.app";

// ── Recipient routing ───────────────────────────────────────────────
//
// For broker quotes, approval routes to the broker — they have the
// "Submit to Shop" action next, and the shop won't see the quote
// until they do. For direct shop quotes, the shop owner is the
// recipient.

export function chooseQuoteApprovalRecipient(quote) {
  if (!quote) return null;
  const isBroker = Boolean(quote.broker_id || quote.broker_email);
  if (isBroker && quote.broker_email) {
    return {
      to: quote.broker_email,
      role: "broker",
      audience_name: quote.broker_name || "Broker",
    };
  }
  if (quote.shop_owner) {
    return {
      to: quote.shop_owner,
      role: "shop_owner",
      audience_name: "Shop",
    };
  }
  return null;
}

// Artwork approval always pings the shop — they're the production
// gatekeeper. (Brokers don't run production; they hand off.)
export function chooseArtworkApprovalRecipient(order) {
  if (!order) return null;
  if (!order.shop_owner) return null;
  return {
    to: order.shop_owner,
    role: "shop_owner",
    audience_name: "Shop",
  };
}

// Payment routing follows the same broker-vs-shop split as quote
// approval: the broker handles their end client; the shop handles
// production. Payment lands → the relevant party gets the heads-up.
export function chooseQuotePaymentRecipient(quote) {
  return chooseQuoteApprovalRecipient(quote);
}

// ── Pure builders ──────────────────────────────────────────────────
//
// Returns { subject, html, reply_to } — the I/O layer attaches `to`
// from chooseXxxRecipient + `from` from env.

export function buildQuoteApprovalEmail({ quote, shop, customer, recipient }) {
  if (!quote) throw new Error("buildQuoteApprovalEmail: quote required");
  if (!recipient) throw new Error("buildQuoteApprovalEmail: recipient required");

  const customerName  = quote.customer_name || customer?.name || "your customer";
  const customerEmail = quote.customer_email || customer?.email || "";
  const quoteIdHuman  = quote.quote_id || quote.id;
  const totalFmt      = formatMoney(quote.total ?? quote.subtotal ?? 0);
  const dateFmt       = formatDate(new Date());

  const isBroker = recipient.role === "broker";
  const nextStep = isBroker
    ? "Open the broker portal to review and submit it to the shop."
    : "Open InkTracker to review the quote and convert it to an order.";
  const ctaUrl   = isBroker
    ? "https://www.inktracker.app/BrokerDashboard"
    : `https://www.inktracker.app/Quotes?id=${encodeURIComponent(quote.id)}`;
  const ctaText  = isBroker ? "Open Broker Portal" : "Open Quote in InkTracker";

  const subject = `Quote ${quoteIdHuman} approved by ${customerName}`;
  const html    = renderEmail({
    headerTitle: "Client Approved Your Quote",
    bodyTitle:   `${customerName} approved quote ${quoteIdHuman}`,
    bodyLines: [
      `Total: <strong>${totalFmt}</strong>`,
      `Approved: ${dateFmt}`,
    ],
    nextStep,
    ctaUrl,
    ctaText,
    shopName: shop?.shop_name || "InkTracker",
  });

  // Reply-to the customer so the shop / broker can reply directly to
  // the person who approved — natural follow-up flow.
  const reply_to = customerEmail || undefined;
  return { subject, html, reply_to };
}

export function buildQuotePaymentEmail({ quote, shop, customer, recipient, orderId, amountPaid }) {
  if (!quote) throw new Error("buildQuotePaymentEmail: quote required");
  if (!recipient) throw new Error("buildQuotePaymentEmail: recipient required");

  const customerName  = quote.customer_name || customer?.name || "your customer";
  const customerEmail = quote.customer_email || customer?.email || "";
  const quoteIdHuman  = quote.quote_id || quote.id;
  // Prefer the amountPaid the caller passes (the actual payment value
  // from the QB webhook/refresh). Fall back to quote.total when not
  // supplied. For deposit-only payments amountPaid is the right value;
  // quote.total would over-state.
  const amount        = Number(amountPaid ?? quote.total ?? 0) || 0;
  const totalFmt      = formatMoney(amount);
  const dateFmt       = formatDate(new Date());

  const isBroker = recipient.role === "broker";
  // When payment lands and converts the quote to an order, the order
  // is the new authoritative entity. For shop owners, route them to
  // the order; for brokers, the broker portal handles routing.
  const ctaUrl   = isBroker
    ? "https://www.inktracker.app/BrokerDashboard"
    : orderId
      ? `https://www.inktracker.app/Orders`
      : `https://www.inktracker.app/Quotes?id=${encodeURIComponent(quote.id)}`;
  const ctaText  = isBroker ? "Open Broker Portal" : "Open Orders in InkTracker";

  const nextStep = isBroker
    ? "Your client paid. The shop has been notified to start production."
    : orderId
      ? "The quote is now an order on your production board. Time to get to work."
      : "Open the quote to review the payment status.";

  const subject = `Payment received: ${totalFmt} on quote ${quoteIdHuman} from ${customerName}`;
  const html    = renderEmail({
    headerTitle: "Client Paid the Quote",
    bodyTitle:   `${customerName} paid ${totalFmt} on quote ${quoteIdHuman}`,
    bodyLines: [
      `Amount: <strong>${totalFmt}</strong>`,
      orderId ? `Order: <strong>${escapeHtml(String(orderId))}</strong>` : "",
      `Paid: ${dateFmt}`,
    ].filter(Boolean),
    nextStep,
    ctaUrl,
    ctaText,
    shopName: shop?.shop_name || "InkTracker",
  });

  const reply_to = customerEmail || undefined;
  return { subject, html, reply_to };
}

export function buildArtworkApprovalEmail({ order, shop, recipient }) {
  if (!order) throw new Error("buildArtworkApprovalEmail: order required");
  if (!recipient) throw new Error("buildArtworkApprovalEmail: recipient required");

  const customerName = order.customer_name || "Customer";
  const orderId      = order.order_id || order.id;
  const jobTitle     = order.job_title || "";
  const approvedBy   = order.art_approved_by || customerName;
  const dateFmt      = formatDate(new Date());

  const subject = `Artwork approved on order ${orderId}`;
  const html    = renderEmail({
    headerTitle: "Client Approved the Artwork",
    bodyTitle:   `${approvedBy} approved artwork for order ${orderId}`,
    bodyLines: [
      jobTitle ? `Job: <strong>${escapeHtml(jobTitle)}</strong>` : "",
      `Customer: ${escapeHtml(customerName)}`,
      `Approved: ${dateFmt}`,
    ].filter(Boolean),
    nextStep: "You're cleared to move this order into production.",
    ctaUrl:   `https://www.inktracker.app/Orders?id=${encodeURIComponent(order.id)}`,
    ctaText:  "Open Order in InkTracker",
    shopName: shop?.shop_name || "InkTracker",
  });

  return { subject, html, reply_to: undefined };
}

// ── Shared email shell ──────────────────────────────────────────────
//
// Mirrors the layout in docs/email-templates/ — system fonts only,
// !important on the white header text, color-scheme meta tag to fight
// dark-mode auto-inversion. Inline styles only; classes won't render.

function renderEmail({ headerTitle, bodyTitle, bodyLines, nextStep, ctaUrl, ctaText, shopName }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(headerTitle)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f3;">
<div style="background-color:#f5f5f3;padding:24px 16px;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0e0e0e;">
  <div style="max-width:560px;margin:0 auto;background-color:#ffffff;border:1px solid #e5e5e5;">

    <!-- Header -->
    <div style="background-color:#1a3a28;padding:32px 28px;text-align:center;">
      <img src="https://www.inktracker.app/icon-512.png" alt="InkTracker" width="52" height="52" style="display:block;border:0;outline:none;margin:0 auto 12px;" />
      <div style="color:#ffffff !important;font-family:Impact,'Arial Narrow Bold',sans-serif;font-size:26px;line-height:1;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;">InkTracker</div>
      <div style="color:rgba(255,255,255,0.75) !important;font-size:12px;line-height:1.4;margin-top:10px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">${escapeHtml(headerTitle)}</div>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px 32px;font-size:15px;line-height:1.6;color:#1a1a1a;">

      <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0e0e0e;letter-spacing:-0.01em;line-height:1.3;">
        ${escapeHtml(bodyTitle)}
      </h1>

      <div style="margin:0 0 20px;color:#4a4a4a;font-size:14px;line-height:1.7;">
        ${bodyLines.map((line) => `<div>${line}</div>`).join("")}
      </div>

      <p style="margin:0 0 24px;color:#4a4a4a;font-size:14px;">${escapeHtml(nextStep)}</p>

      <div style="text-align:center;margin:0 0 18px;">
        <a href="${ctaUrl}"
           style="display:inline-block;background-color:#2c5840;color:#ffffff !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:14px 36px;text-decoration:none;border-radius:4px;mso-padding-alt:0;">
          ${escapeHtml(ctaText)}
        </a>
      </div>

      <p style="margin:32px 0 0;color:#999;font-size:12px;line-height:1.5;text-align:center;">
        You're receiving this because you're listed as the recipient for ${escapeHtml(shopName)} approvals.
      </p>

    </div>

  </div>
</div>
</body>
</html>`;
}

// ── I/O: Resend send ────────────────────────────────────────────────

/**
 * Best-effort send. Returns { ok, reason } and NEVER throws. The
 * caller already committed the approval write; an email failure
 * shouldn't fail the function or roll back state.
 */
export async function sendApprovalNotification({ to, subject, html, reply_to }, env) {
  // typeof guard so the helper imports cleanly in Node (vitest) as
  // well as Deno (edge runtime). Without it, the bare `Deno?.env`
  // default param threw a ReferenceError under Node — discovered
  // when the SLN2 test wired through to this code path.
  const runtimeEnv = env ?? (typeof Deno !== "undefined" ? Deno.env : undefined);
  const apiKey  = runtimeEnv?.get?.("RESEND_API_KEY") || "";
  // Fall back to FROM_EMAIL — the secret every other sender reads — before
  // the hardcoded default, so this path can never diverge from them again.
  const sendFrom =
    runtimeEnv?.get?.("APPROVAL_SEND_FROM") ||
    runtimeEnv?.get?.("FROM_EMAIL") ||
    SEND_FROM_DEFAULT;

  if (!apiKey)  return { ok: false, reason: "no_api_key" };
  if (!to)      return { ok: false, reason: "no_recipient" };
  if (!subject) return { ok: false, reason: "no_subject" };

  // Transport (retry/backoff on 429/5xx/network) lives in resendClient —
  // this used to be a bare fetch where any transient error lost the email.
  const result = await sendResendEmail({
    from: `InkTracker <${sendFrom}>`,
    to: [to],
    subject,
    html,
    ...(reply_to ? { reply_to } : {}),
  }, { apiKey, env: runtimeEnv });
  if (!result.ok) {
    return { ok: false, reason: result.reason || "exception" };
  }
  return { ok: true, id: result.id };
}

// ── notification_log writer ─────────────────────────────────────────
//
// Records every notification attempt — sent, failed, or skipped —
// so operators can see "we tried, here's what happened" without
// digging through edge-function console logs. The migration that
// created the table is 20260618000000_notification_log.sql; see
// that file for schema + rationale.
//
// Best-effort: a failure to write the audit row never throws or
// blocks the caller. We log to console.error and move on. The
// notification path itself is the user-visible side effect; this
// row is observability for after-the-fact diagnosis.

/**
 * @typedef {Object} NotificationLogContext
 * @property {string} shop_owner       Required. Tenant scope.
 * @property {'quote_approval'|'artwork_approval'|'quote_payment'|'quote_send'|'reply'|'payment_confirmation'|'trial_reminder'} event_type
 *   Mirror of the notification_log_event_type_check constraint
 *   (20260825000000) — keep the two lists in lockstep.
 * @property {string} recipient_email
 * @property {string|null} [recipient_role]  'shop_owner' | 'broker' | 'customer'
 * @property {string|null} [quote_id]       quotes.id UUID (NOT the human "Q-####")
 * @property {string|null} [order_id]       UUID
 * @property {string|null} [subject]
 * @property {'sent'|'failed'|'skipped'} status
 * @property {string|null} [failure_reason] Required when status='failed' or 'skipped'.
 * @property {string|null} [resend_id]      Resend's message id, when known.
 */

/**
 * Insert one row into notification_log.
 * @param {object} supabase service-role client
 * @param {NotificationLogContext} ctx
 */
export async function logNotificationAttempt(supabase, ctx) {
  if (!supabase) return;
  if (!ctx?.shop_owner || !ctx?.event_type || !ctx?.status) {
    console.error("[notification_log] missing required fields:", ctx);
    return;
  }
  try {
    const row = buildNotificationLogRow(ctx);
    const { error } = await supabase.from("notification_log").insert(row);
    if (error) console.error("[notification_log] insert failed:", error.message);
  } catch (err) {
    console.error("[notification_log] insert threw:", err?.message || err);
  }
}

// Pure builder, exposed so tests can pin the row shape without
// touching Supabase.
export function buildNotificationLogRow(ctx) {
  return {
    shop_owner:      ctx.shop_owner,
    event_type:      ctx.event_type,
    recipient_email: ctx.recipient_email ?? "",
    recipient_role:  ctx.recipient_role  ?? null,
    quote_id:        ctx.quote_id        ?? null,
    order_id:        ctx.order_id        ?? null,
    subject:         ctx.subject         ?? null,
    status:          ctx.status,
    failure_reason:  ctx.failure_reason  ?? null,
    resend_id:       ctx.resend_id       ?? null,
  };
}

/**
 * Wrapper used by edge-function callers: builds the email, sends it,
 * logs the attempt. One function per call site instead of two.
 *
 * @param {object} supabase service-role client
 * @param {Omit<NotificationLogContext, 'status'|'failure_reason'|'resend_id'> & {to: any, subject: any, html: any, reply_to: any}} args
 *   `status`/`failure_reason`/`resend_id` are set internally per send outcome,
 *   so callers don't pass them.
 */
export async function sendAndLogApprovalNotification(supabase, args) {
  // Required for the audit row even if the send is skipped (no
  // recipient → log a 'skipped' row so operators can see we tried).
  const { shop_owner, event_type, quote_id, order_id, recipient_email, recipient_role,
          to, subject, html, reply_to } = args;

  // Skipped path — caller decided not to send (e.g., no recipient
  // resolved). Still log so the row exists for forensics.
  if (!to) {
    await logNotificationAttempt(supabase, {
      shop_owner, event_type, quote_id, order_id,
      recipient_email: "", recipient_role,
      subject: subject ?? null,
      status: "skipped",
      failure_reason: "no_recipient",
    });
    return { ok: false, reason: "no_recipient" };
  }

  const result = await sendApprovalNotification({ to, subject, html, reply_to });
  await logNotificationAttempt(supabase, {
    shop_owner, event_type, quote_id, order_id,
    recipient_email: to,
    recipient_role,
    subject,
    status: result.ok ? "sent" : "failed",
    failure_reason: result.ok ? null : result.reason,
    // Resend's message id — joins a log row to the Resend dashboard. The
    // column existed since 20260618 but nothing populated it.
    resend_id: result.id ?? null,
  });
  return result;
}

// ── Tiny utils ──────────────────────────────────────────────────────

function formatMoney(n) {
  const num = Number(n) || 0;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
