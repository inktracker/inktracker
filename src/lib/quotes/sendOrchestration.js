import { resolveArtworkPath } from "@/lib/artworkPath";
import { customerFacingShopName } from "./customerFacingQuote";

// Pure orchestration logic for the Send Quote flow.
//
// This is the highest-stakes path in the app — it's the moment a
// quote leaves the building and ends up in a customer's inbox. The
// modal that drives it (src/components/quotes/SendQuoteModal.jsx)
// used to inline all of this logic, which is exactly what let the
// duplicate-QB-invoice bug ship: branchy state in JSX with no test
// coverage.
//
// Every export here is pure (no React, no Supabase). The modal is a
// thin shell that calls these and wires the results into setState /
// supabase.functions.invoke / base44.entities calls.
//
// Invariants pinned in `__tests__/sendOrchestration.test.js`:
//
//   parseRecipients
//     R1  comma + whitespace tolerant
//     R2  drops empties, dedupes case-insensitively, preserves order
//     R3  single-recipient string still works (no comma)
//     R4  obviously-malformed entries are dropped (no '@', or '@' with
//         nothing on one side)
//
//   decidePublicToken
//     T1  if quote already has public_token → reuse it, no persist
//     T2  if quote lacks public_token → mint a new one + flag persist
//     T3  empty-string token is treated as missing (mint)
//     T4  generator can be injected so tests are deterministic
//     T5  resending an already-sent quote NEVER rotates the token
//         (old email links must stay valid)
//
//   shouldClearQbPaymentLink
//     C1  Stripe + has QB link  → true  (route customer to Stripe)
//     C2  Stripe + no QB link   → false (nothing to clear)
//     C3  QB     + has QB link  → false (we want the QB link!)
//     C4  QB     + no QB link   → false (nothing to clear)
//     C5  Either local or row-level QB link counts as "has"
//
//   nextStatusOnSend
//     S1  Draft               → Sent
//     S2  Pending             → Pending  (manual marker, don't override)
//     S3  Sent                → Sent     (resend doesn't break status)
//     S4  Approved            → Approved (resend doesn't downgrade)
//     S5  Approved and Paid   → Approved and Paid
//     S6  Declined            → Declined (resend exists to nudge, status sticks)
//
//   buildSendQuoteEmailRequest
//     E1  Always includes the payment link (the whole point of sending)
//     E2  Subject is the caller-tagged subject (with Ref tag injected)
//     E3  PDF base64 + filename pass through when present
//     E4  Broker fields (broker_name / broker_email) pass through
//     E5  shopOwnerEmail always carried (Resend uses it as Reply-To)
//
//   buildPostSendQuotePatch
//     P1  status set per nextStatusOnSend
//     P2  sent_to is comma-joined recipients
//     P3  sent_date is ISO from the injected clock
//     P4  totals from the editor (sub/tax/total) are persisted
//     P5  For broker quotes, tax_rate is forced to 0
//     P6  For non-broker quotes, tax_rate is preserved as-is
//     P7  customer_email is the FIRST recipient (canonical address)

// public_token gates anonymous access to a quote's payment/approval page, so it
// MUST be cryptographically unguessable. Never fall back to Math.random — a
// Date.now()+Math.random() token is predictable, letting an attacker enumerate
// other shops' quote links. crypto.randomUUID exists in every supported
// browser/runtime; if it's missing, fail loudly rather than mint a weak token.
const DEFAULT_TOKEN_GENERATOR = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure random unavailable — cannot mint a quote access token.");
  return uuid.replace(/-/g, "");
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── parseRecipients ─────────────────────────────────────────────────

/**
 * Parse a comma-separated recipient string into a clean list of
 * email addresses. Trims, dedupes case-insensitively, drops empties,
 * filters obvious non-emails (no @ at all, or @ with nothing on one
 * side).
 *
 * Order is preserved — the first email in the input becomes
 * recipientEmails[0], which is what we persist as
 * quote.customer_email for future reference.
 */
export function parseRecipients(input) {
  if (input == null) return [];
  const raw = String(input).split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const candidate of raw) {
    if (!EMAIL_SHAPE.test(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

// ── decidePublicToken ───────────────────────────────────────────────

/**
 * Decide whether to reuse the quote's existing public_token or mint
 * a new one. Caller persists the new token to the DB when
 * `needsPersist` is true.
 *
 * Critical contract: NEVER rotate an existing token. Old email links
 * must remain valid even when the shop resends the quote.
 *
 * @param {object} quote
 * @param {() => string} generator — injectable for tests
 * @returns {{ token: string, needsPersist: boolean }}
 */
export function decidePublicToken(quote, generator = DEFAULT_TOKEN_GENERATOR) {
  const existing = (quote?.public_token ?? "").toString().trim();
  if (existing) {
    return { token: existing, needsPersist: false };
  }
  return { token: generator(), needsPersist: true };
}

// ── shouldClearQbPaymentLink ────────────────────────────────────────

/**
 * Decide whether to NULL out the quote's `qb_payment_link` before
 * sending. True when the user picked Stripe but the quote (or local
 * state) still has a QB link from a prior Create QB Invoice — left
 * in place, /quotepayment would route the customer to QB instead of
 * Stripe.
 *
 * @param {"stripe" | "qb"} paymentProvider
 * @param {string | null} quoteQbPaymentLink — from the persisted row
 * @param {string | null} localQbPaymentLink — from in-modal state (a
 *   Create-then-switch can have a value here that hasn't round-tripped)
 */
export function shouldClearQbPaymentLink(paymentProvider, quoteQbPaymentLink, localQbPaymentLink) {
  if (paymentProvider !== "stripe") return false;
  return Boolean(quoteQbPaymentLink || localQbPaymentLink);
}

// ── nextStatusOnSend ────────────────────────────────────────────────

/**
 * Decide the quote's status after a successful send. Draft → Sent
 * (so the dashboard shows it left the building). Every other status
 * is preserved — a resend never DOWNGRADES status. This is what
 * makes "send again to nudge the customer" safe.
 *
 * @param {string | null | undefined} currentStatus
 * @returns {string}
 */
export function nextStatusOnSend(currentStatus) {
  const s = (currentStatus ?? "").toString();
  if (!s || s === "Draft") return "Sent";
  return s;
}

// ── extractProofImageUrls ───────────────────────────────────────────

/**
 * Pull customer-facing proof IMAGE urls off a quote's selected_artwork for
 * inline embedding in the quote email. Images only (png/jpg/gif/webp) — PDFs
 * can't render inline in email, so they're skipped (the customer still sees
 * them on the linked QuotePayment page). Capped to keep the email lean.
 *
 * @param {object} quote
 * @returns {Array<{url:string,name:string}>}
 */
// M-1: artwork is moving to a private bucket, so the emailed proof <img> can no
// longer point at a public storage URL. Instead point each one at the
// token-gated artworkProof proxy, which 302-redirects to a fresh signed URL on
// every open — the inline image keeps working forever without exposing a public
// or guessable URL. Needs the quote's id + public_token; without them (e.g. a
// quote that never minted a token) we emit nothing rather than a broken/leaky
// link.
export function extractProofImageUrls(quote) {
  const art = Array.isArray(quote?.selected_artwork) ? quote.selected_artwork : [];
  const id = quote?.id || quote?.quote_id || "";
  const token = (quote?.public_token ?? "").toString().trim();
  const base = (import.meta?.env?.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  if (!id || !token || !base) return [];
  const out = [];
  for (const a of art) {
    const path = resolveArtworkPath(a?.path || a?.url || a?.file_url);
    if (!path) continue;
    const clean = path.split("?")[0].toLowerCase();
    if (!/\.(png|jpe?g|gif|webp)$/.test(clean)) continue; // images only
    const url = `${base}/functions/v1/artworkProof?type=quote&id=${encodeURIComponent(id)}` +
      `&token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;
    out.push({ url, name: a?.name || "Art proof" });
    if (out.length >= 6) break;
  }
  return out;
}

// ── buildSendQuoteEmailRequest ──────────────────────────────────────

// The sendQuoteEmail edge function OOMs (546 WORKER_LIMIT) somewhere between
// a 25 MB body (verified fine) and the 94 MB one a shop's 4200×4200 logo once
// produced. Upload + PDF-embed downscaling should keep PDFs ~1 MB now; this is
// the last-ditch net so a pathological PDF degrades to "email without
// attachment" (the customer still gets the payment link) instead of a failed
// send that also strands the already-created QB invoice.
export const MAX_PDF_ATTACHMENT_B64_CHARS = 15 * 1024 * 1024;

/**
 * Build the request body for the `sendQuoteEmail` edge function.
 * All keys are explicit so the wire contract is auditable in one
 * place — the modal doesn't have to remember which keys go where.
 *
 * @param {object} args
 * @param {object} args.quote
 * @param {string[]} args.recipients
 * @param {string} args.taggedSubject — already has the [Ref: ...] tag
 * @param {string} args.body
 * @param {string} args.paymentLink
 * @param {string} args.shopName
 * @param {string} [args.shopLogoUrl] — shop's logo for the email header
 * @param {string | null} args.pdfBase64 — null if PDF gen failed
 */
export function buildSendQuoteEmailRequest({
  quote,
  recipients,
  taggedSubject,
  body,
  paymentLink,
  shopName,
  shopLogoUrl,
  pdfBase64,
}) {
  // Single source of truth for customer-facing brand: shared with the
  // /QuotePayment header and any other end-client surface, via
  // customerFacingShopName in customerFacingQuote.js. Resolution:
  // broker_company → broker_name → shopName → fallback. Without this,
  // an empty shopName on a broker quote leaked the literal
  // "Your Shop" placeholder into end clients' inboxes (the
  // 2026-05-31 regression Joe screenshotted).
  const effectiveShopName = customerFacingShopName({
    quote,
    shopName,
    fallback: "Your Shop",
  });

  if (pdfBase64 && pdfBase64.length > MAX_PDF_ATTACHMENT_B64_CHARS) {
    console.warn(
      `[buildSendQuoteEmailRequest] dropping ${Math.round(pdfBase64.length / 1024 / 1024)} MB ` +
      "PDF attachment — payload this large would OOM the sendQuoteEmail edge function (546)."
    );
    pdfBase64 = null;
  }

  return {
    customerEmails: recipients,
    customerName: quote?.customer_name ?? "",
    quoteId: quote?.quote_id ?? "",
    quoteTotal: quote?.total ?? null,
    paymentLink,
    approveLink: paymentLink,
    shopName: effectiveShopName,
    shopLogoUrl: shopLogoUrl || "",
    subject: taggedSubject,
    body,
    brokerName: quote?.broker_name ?? "",
    brokerEmail: quote?.broker_id ?? quote?.broker_email ?? "",
    pdfBase64,
    pdfFilename: `Quote-${quote?.quote_id || "draft"}.pdf`,
    shopOwnerEmail: quote?.shop_owner ?? "",
    proofImages: extractProofImageUrls(quote),
  };
}

// ── buildPostSendQuotePatch ─────────────────────────────────────────

/**
 * Build the patch applied to the quote row AFTER a successful send.
 * Persists status transition, sent_to / sent_date for audit, the
 * editor's final totals, and the canonical customer_email.
 *
 * Broker-quote rule: tax_rate forced to 0 (brokers don't collect
 * sales tax through us — the shop bills the broker directly, broker
 * bills the end customer separately).
 *
 * @param {object} args
 * @param {string | null} args.currentStatus
 * @param {string[]} args.recipients
 * @param {{ sub: number, tax: number, total: number }} args.totals
 * @param {boolean} args.isBrokerQuote
 * @param {number} args.currentTaxRate
 * @param {() => string} args.nowIso — injectable for tests
 */
export function buildPostSendQuotePatch({
  currentStatus,
  recipients,
  totals,
  isBrokerQuote,
  currentTaxRate,
  nowIso = () => new Date().toISOString(),
}) {
  return {
    status: nextStatusOnSend(currentStatus),
    sent_to: recipients.join(", "),
    sent_date: nowIso(),
    subtotal: totals?.sub ?? null,
    tax: totals?.tax ?? null,
    total: totals?.total ?? null,
    tax_rate: isBrokerQuote ? 0 : (currentTaxRate ?? 0),
    customer_email: recipients[0] ?? "",
  };
}
