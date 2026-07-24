// QuickBooks nightly reconciliation cron.
//
// Authenticated by CRON_SECRET header (NOT user JWT). Invoked by the
// Vercel cron route /api/qb-reconcile-cron, which proxies to here so
// the secret stays on the server side.
//
// For every shop with a valid QB connection, this function:
//   1. Selects quotes with a linked qb_invoice_id that aren't yet
//      "Converted to Order" (the candidate window — recent + linked +
//      still live).
//   2. Fetches each invoice's current state from QB.
//   3. Classifies drift via classifyQuoteDrift (pure).
//   4. Acts on the classification:
//        - PAID_NOT_RECORDED → silently convert (same path as webhook)
//        - TOTALS_DRIFT      → push a "warning" shop notification
//        - MISSING_IN_QB     → push a "warning" shop notification
//        - OK / INVALID      → no-op
//   5. Writes one qb_event_log row per quote with the outcome.
//   6. Returns a summary { shops, by_kind: {...} } for the Vercel
//      route to log + surface in monitoring.
//
// Failure semantics: per-shop and per-quote errors are caught and
// counted; the cron never aborts on one bad shop. Per-quote errors
// land in qb_event_log with status='error', so operators can grep
// for "what failed overnight" without re-running anything.
//
// Deploy: npx supabase functions deploy qbReconcile --no-verify-jwt
// (CRON_SECRET is the actual auth, not the Supabase JWT.)

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import { captureError } from "../_shared/observability.ts";
import {
  loadProfileWithSecrets,
  updateProfileSecrets,
} from "../_shared/profileSecrets.ts";
import {
  decideTokenRefresh,
  buildRefreshedTokenFields,
} from "../_shared/connectionLogic.js";
import { validateQbTokenResponse } from "../_shared/qbOAuthResponse.js";
import { refreshQbTokenSerialized } from "../_shared/qbTokenLock.js";
import { escapeQbStringLiteral } from "../_shared/qbInvoice.js";
import { logEvent } from "../_shared/qbAudit.js";
import {
  classifyQuoteDrift,
  buildReconcileNotification,
  summarizeReconciliation,
  DRIFT_KINDS,
} from "../_shared/qbReconcileLogic.js";
import { buildQuotePatchFromFreshInvoice } from "../_shared/qbRefreshLogic.js";
import { parseRetryAfterMs } from "../_shared/qbRateLimit.ts";
import { convertQuoteToOrder } from "../_shared/qbConvertQuote.js";
import {
  isInvoiceFullyPaid,
  isRecentQbPayment,
  cascadeMarkLinkedPaid,
  cascadeMarkInvoicePaid,
} from "../_shared/qbWebhookLogic.js";
import { recordShopNotification, buildBooksDriftNotification } from "../_shared/shopNotifications.js";
import {
  chooseQuotePaymentRecipient,
  buildQuotePaymentEmail,
  sendAndLogApprovalNotification,
} from "../_shared/approvalNotificationEmail.js";
import {
  summarizeQbErrors,
  shouldSendErrorDigest,
  buildQbErrorDigestText,
  buildQbErrorDigestHtml,
} from "../_shared/qbErrorDigest.js";
import {
  summarizeNotificationFailures,
  shouldSendEmailHealthAlert,
  buildEmailHealthAlertText,
} from "../_shared/emailHealthAlert.js";
import {
  shouldSendIntegrityAlert,
  buildIntegrityAlertText,
} from "../_shared/dataIntegrity.js";
import {
  findDriftRows,
  verifyDriftRow,
  summarizeBooksDrift,
  shouldSendBooksDriftAlert,
  buildBooksDriftAlertText,
} from "../_shared/booksDriftAlert.js";

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_BASE          = "https://quickbooks.api.intuit.com/v3/company";
const CRON_SECRET      = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional. When set together with RESEND_API_KEY, the cron emails a
// digest at the start of each run if the past 24 hours' qb_event_log
// has >= QB_ERROR_DIGEST_THRESHOLD error rows. Failure to send the
// alert NEVER blocks reconciliation — it's monitoring, not the work.
const OPERATOR_ALERT_EMAIL = Deno.env.get("OPERATOR_ALERT_EMAIL") ?? "";
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERT_FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "quotes@info.inktracker.app";

// Constant-time string compare. Used for the CRON_SECRET bearer
// check below — `!==` short-circuits on the first mismatched byte
// and leaks character-position timing under a high-resolution clock.
// The secret is high-entropy and Vercel rate-limits, so the practical
// risk is near-zero, but the standard mitigation is essentially free.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// ── Token loading (same shape as qbSync/qbWebhook) ──────────────────

async function refreshTokenViaQB(refreshTok: string) {
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type":  "application/x-www-form-urlencoded",
      "Accept":        "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshTok }),
  });
  if (!res.ok) throw new Error(`QB refresh ${res.status}`);
  return await res.json();
}

async function ensureFreshToken(adminClient: any, profile: any) {
  if (decideTokenRefresh(profile.qb_token_expires_at) && !profile.qb_refresh_token) {
    throw new Error(`profile ${profile.id} has no qb_refresh_token`);
  }
  // Refresh (when needed) under the shared DB lease lock so a nightly
  // reconcile and a live qbSync action don't double-refresh and clobber QB's
  // rotating refresh token. Validates the refresh response shape before trust.
  const { accessToken } = await refreshQbTokenSerialized(adminClient, profile, {
    decideRefresh: decideTokenRefresh,
    refreshFn: async (refreshTok: string) => {
      const fresh = await refreshTokenViaQB(refreshTok);
      const check = validateQbTokenResponse(fresh);
      if (!check.ok) throw new Error(`QB refresh body malformed: ${check.reason}`);
      return fresh;
    },
    buildFields: buildRefreshedTokenFields,
    persist: (id: string, fields: any) => updateProfileSecrets(adminClient, id, fields),
    reload: (id: string) => loadProfileWithSecrets(adminClient, { id }),
  });
  return accessToken;
}

// Minimal QB query. 429s are retried honoring Retry-After (same
// qbRateLimit helper qbSync uses) — without this, a rate-limited window
// turned every remaining invoice in the run into a false "error"
// classification and skipped its real reconciliation. Other errors still
// throw so one bad invoice doesn't tank the cron (recorded per-quote).
async function qbQuery(token: string, realmId: string, q: string) {
  const url = `${QB_BASE}/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=65`;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept":        "application/json",
      },
    });
    if (res.ok) return await res.json();
    if (res.status === 429 && attempt < MAX_ATTEMPTS - 1) {
      const wait = parseRetryAfterMs(res.headers.get("retry-after")) ?? 1000 * 2 ** attempt;
      await res.text().catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    throw new Error(`QB query ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// ── One-shop reconciliation pass ─────────────────────────────────────

async function reconcileShop(adminClient: any, profile: any) {
  // Owners (role shop/admin) have profiles.shop_owner = NULL; their quotes are
  // keyed by their own email. Canonical key = shop_owner || email. Using the
  // bare shop_owner skipped every owner's shop (the reason reconcile found 0).
  const shopOwner = profile.shop_owner || profile.email;
  if (!shopOwner) throw new Error(`profile ${profile.id} has no shop_owner or email`);

  let accessToken: string;
  try {
    accessToken = await ensureFreshToken(adminClient, profile);
  } catch (err) {
    return { shopOwner, classifications: [{ error: (err as Error)?.message }] };
  }
  const realmId: string = profile.qb_realm_id;

  // Candidate window: linked quotes that haven't yet converted.
  // Limit to the last 60 days so a shop with thousands of old quotes
  // doesn't burn the cron budget every night.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await adminClient
    .from("quotes")
    .select("id, quote_id, shop_owner, qb_invoice_id, qb_total, status, converted_order_id, customer_id, customer_name, customer_email, job_title, date, due_date, line_items, notes, rush_rate, extras, discount, discount_type, tax_rate, subtotal, tax, total, broker_id, broker_email, broker_name, broker_company, selected_artwork")
    .eq("shop_owner", shopOwner)
    .not("qb_invoice_id", "is", null)
    .neq("status", "Converted to Order")
    .is("converted_order_id", null)
    .gte("date", sixtyDaysAgo.slice(0, 10))
    .limit(500);

  if (error) {
    return { shopOwner, classifications: [{ error: `candidates query: ${error.message}` }] };
  }

  const classifications: any[] = [];
  for (const quote of candidates ?? []) {
    try {
      const result = await reconcileOneQuote(adminClient, accessToken, realmId, quote, shopOwner);
      classifications.push(result);
    } catch (err) {
      classifications.push({ error: (err as Error)?.message, qb_invoice_id: quote.qb_invoice_id });
      await logEvent(adminClient, {
        shop_owner:    shopOwner,
        action:        "reconcile_invoice",
        status:        "error",
        quote_id:      quote.id,
        qb_invoice_id: quote.qb_invoice_id,
        error_message: (err as Error)?.message,
      });
    }
  }

  // Second pass — converted-but-unpaid quotes. The first pass excludes
  // these (its candidate window requires status≠"Converted to Order"),
  // but they're exactly the rows where a customer might have paid
  // AFTER the quote was already converted manually. Without this pass,
  // a missed webhook for the user's "approved → converted → paid later"
  // scenario stays uncaught until month-end manual reconciliation.
  // Matches the new MARK_LINKED_PAID branch in qbWebhook.
  // NOTE: `quotes` has no `paid` column (orders/invoices do, not quotes).
  // The old `.select("…paid…")` + `.eq("paid", false)` here raised 42703 and
  // failed the whole pass. The "is it already paid?" check is done inside
  // reconcileCascadeQuote by walking quote → order → invoice, so we don't
  // need a quote-level paid filter — just feed it the converted quotes.
  const { data: cascadeCandidates, error: cascadeErr } = await adminClient
    .from("quotes")
    .select("id, quote_id, shop_owner, qb_invoice_id, status, converted_order_id, customer_id, customer_name, customer_email, broker_id, broker_email, broker_name, broker_company, total")
    .eq("shop_owner", shopOwner)
    .not("qb_invoice_id", "is", null)
    .or("status.eq.Converted to Order,converted_order_id.not.is.null")
    .gte("date", sixtyDaysAgo.slice(0, 10))
    .limit(500);
  if (cascadeErr) {
    classifications.push({ error: `cascade candidates query: ${cascadeErr.message}` });
  } else {
    for (const quote of cascadeCandidates ?? []) {
      try {
        const result = await reconcileCascadeQuote(adminClient, accessToken, realmId, quote, shopOwner);
        classifications.push(result);
      } catch (err) {
        classifications.push({ error: (err as Error)?.message, qb_invoice_id: quote.qb_invoice_id });
        await logEvent(adminClient, {
          shop_owner:    shopOwner,
          action:        "reconcile_invoice_cascade",
          status:        "error",
          quote_id:      quote.id,
          qb_invoice_id: quote.qb_invoice_id,
          error_message: (err as Error)?.message,
        });
      }
    }
  }

  // Third pass — invoices linked to QB that aren't tied to a quote
  // (orders completed via runOrderCompletion without going through Send
  // Quote first). Catches the "invoice exists, no matching quote row"
  // path. Mirrors the qbWebhook fallback branch.
  const { data: invoiceCandidates, error: invErr } = await adminClient
    .from("invoices")
    .select("id, invoice_id, shop_owner, qb_invoice_id, paid, order_id")
    .eq("shop_owner", shopOwner)
    .eq("paid", false)
    .not("qb_invoice_id", "is", null)
    .gte("date", sixtyDaysAgo.slice(0, 10))
    .limit(500);
  if (invErr) {
    classifications.push({ error: `invoice candidates query: ${invErr.message}` });
  } else {
    for (const invoice of invoiceCandidates ?? []) {
      try {
        const result = await reconcileCascadeInvoice(adminClient, accessToken, realmId, invoice, shopOwner);
        classifications.push(result);
      } catch (err) {
        classifications.push({ error: (err as Error)?.message, qb_invoice_id: invoice.qb_invoice_id });
        await logEvent(adminClient, {
          shop_owner:    shopOwner,
          action:        "reconcile_invoice_cascade",
          status:        "error",
          qb_invoice_id: invoice.qb_invoice_id,
          error_message: (err as Error)?.message,
        });
      }
    }
  }

  // Fourth pass — books-drift verification. Mirror-flagged candidates
  // (row total vs qb_total) are re-checked against the LIVE QB invoice
  // while we hold this shop's token: stale mirrors self-heal (the Kato
  // false-alarm class — invoice corrected in QBO after create, mirror
  // frozen at the born value), and only rows that STILL diverge from
  // QB's current TotalAmt are returned for the operator alert.
  const driftRows: any[] = [];
  try {
    const DRIFT_LIVE_CHECK_CAP = 25;
    const [{ data: qRows }, { data: iRows }] = await Promise.all([
      adminClient
        .from("quotes")
        .select("id, quote_id, shop_owner, qb_invoice_id, total, qb_total")
        .eq("shop_owner", shopOwner)
        .not("qb_total", "is", null)
        .not("qb_invoice_id", "is", null)
        .limit(2000),
      adminClient
        .from("invoices")
        .select("id, invoice_id, shop_owner, qb_invoice_id, total, qb_total")
        .eq("shop_owner", shopOwner)
        .not("qb_total", "is", null)
        .not("qb_invoice_id", "is", null)
        .limit(2000),
    ]);
    const candidatesToVerify: any[] = [
      ...findDriftRows((qRows ?? []).map((r: any) => ({ ...r, ref: r.quote_id, table: "quotes" }))),
      ...findDriftRows((iRows ?? []).map((r: any) => ({ ...r, ref: r.invoice_id, table: "invoices" }))),
    ];
    if (candidatesToVerify.length > DRIFT_LIVE_CHECK_CAP) {
      console.warn(`[qbReconcile] drift verify capped at ${DRIFT_LIVE_CHECK_CAP}/${candidatesToVerify.length} for ${shopOwner}`);
    }
    for (const cand of candidatesToVerify.slice(0, DRIFT_LIVE_CHECK_CAP)) {
      try {
        const resp = await qbQuery(accessToken, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(cand.qb_invoice_id)}'`);
        const live = resp?.QueryResponse?.Invoice?.[0] ?? null;
        const verdict = verifyDriftRow(cand, live);
        // Self-heal the mirror regardless of verdict — next scan starts honest.
        if (verdict.mirrorPatch) {
          await adminClient.from(cand.table).update(verdict.mirrorPatch)
            .eq("id", cand.id).eq("shop_owner", shopOwner);
        }
        if (verdict.status === "confirmed") {
          driftRows.push({ ...verdict.row, source: cand.table });
        }
      } catch (err) {
        // A failed live check must not fabricate OR suppress an alert row —
        // skip it this run; the mirror stays flagged for the next night.
        console.warn(`[qbReconcile] drift verify failed for ${cand.ref}:`, (err as Error)?.message);
      }
    }
  } catch (err) {
    console.warn(`[qbReconcile] drift pass failed for ${shopOwner}:`, (err as Error)?.message);
  }

  return { shopOwner, classifications, driftRows };
}

// Cascade handler for converted-but-unpaid quotes. If QB shows the
// invoice fully paid, walk quote → order → invoice and mark all three.
// Best-effort payment notification — same email the webhook would send.
async function reconcileCascadeQuote(
  adminClient: any,
  token: string,
  realmId: string,
  quote: any,
  shopOwner: string,
) {
  const resp = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(quote.qb_invoice_id)}'`);
  const freshInvoice = resp?.QueryResponse?.Invoice?.[0] || null;
  if (!isInvoiceFullyPaid(freshInvoice)) {
    return { kind: "cascade-skip", reason: "not paid in QB", qb_invoice_id: quote.qb_invoice_id };
  }

  const today = new Date().toISOString().slice(0, 10);
  const updates = await cascadeMarkLinkedPaid(adminClient, quote, today);

  await logEvent(adminClient, {
    shop_owner:    shopOwner,
    action:        "reconcile_invoice_cascade",
    status:        "success",
    quote_id:      quote.id,
    qb_invoice_id: quote.qb_invoice_id,
    response_body: { cascade: true, ...updates },
  });

  // Only email when a local flag actually flipped AND the QB payment is
  // recent. A flag flipping on an invoice QB last touched months ago is
  // stale bookkeeping (e.g. a backfill), not a fresh payment worth a
  // "Payment received" email — see isRecentQbPayment. The DB flips above
  // and the audit log already happened regardless.
  const somethingFlipped = updates.quoteUpdated || updates.orderUpdated || updates.invoiceUpdated;
  if (somethingFlipped && !isRecentQbPayment(freshInvoice)) {
    await logEvent(adminClient, {
      shop_owner:    shopOwner,
      action:        "reconcile_invoice_cascade",
      status:        "skipped",
      quote_id:      quote.id,
      qb_invoice_id: quote.qb_invoice_id,
      response_body: { notify_skipped: "stale_payment", last_updated: freshInvoice?.MetaData?.LastUpdatedTime ?? null },
    });
  } else if (somethingFlipped) {
    try {
      const recipient = chooseQuotePaymentRecipient(quote);
      let email: any = null;
      if (recipient) {
        const { data: shopRow } = await adminClient
          .from("shops")
          .select("shop_name")
          .eq("owner_email", shopOwner)
          .maybeSingle();
        email = buildQuotePaymentEmail({
          quote, shop: shopRow, customer: null, recipient,
          orderId: quote.converted_order_id, amountPaid: quote.total,
        });
      }
      await sendAndLogApprovalNotification(adminClient, {
        shop_owner: shopOwner,
        event_type: "quote_payment",
        quote_id:   quote.id,
        recipient_email: recipient?.to ?? "",
        recipient_role:  recipient?.role,
        to:       recipient?.to,
        subject:  email?.subject,
        html:     email?.html,
        reply_to: email?.reply_to,
      });
    } catch (notifyErr) {
      console.error("[qbReconcile] cascade notification failed:", notifyErr);
    }
  }

  return { kind: "cascade", ...updates };
}

// Mirror handler for the invoice-side path (no quote ever existed).
// Walks invoice → linked order. No payment notification — without a
// quote we don't have a payment-recipient email; operator sees the
// flip in their list view.
async function reconcileCascadeInvoice(
  adminClient: any,
  token: string,
  realmId: string,
  invoice: any,
  shopOwner: string,
) {
  const resp = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(invoice.qb_invoice_id)}'`);
  const freshInvoice = resp?.QueryResponse?.Invoice?.[0] || null;
  if (!isInvoiceFullyPaid(freshInvoice)) {
    return { kind: "cascade-invoice-skip", reason: "not paid in QB", qb_invoice_id: invoice.qb_invoice_id };
  }

  const today = new Date().toISOString().slice(0, 10);
  const updates = await cascadeMarkInvoicePaid(adminClient, invoice, today);

  await logEvent(adminClient, {
    shop_owner:    shopOwner,
    action:        "reconcile_invoice_cascade",
    status:        "success",
    qb_invoice_id: invoice.qb_invoice_id,
    response_body: { cascade: "invoice", ...updates },
  });

  return { kind: "cascade-invoice", ...updates };
}

async function reconcileOneQuote(
  adminClient: any,
  token: string,
  realmId: string,
  quote: any,
  shopOwner: string,
) {
  // Pull current QB state.
  const resp = await qbQuery(token, realmId, `SELECT * FROM Invoice WHERE Id = '${escapeQbStringLiteral(quote.qb_invoice_id)}'`);
  const freshInvoice = resp?.QueryResponse?.Invoice?.[0] || null;

  const classification = classifyQuoteDrift(freshInvoice, quote);

  // For OK and INVALID, just log and move on.
  if (classification.kind === DRIFT_KINDS.OK || classification.kind === DRIFT_KINDS.INVALID) {
    await logEvent(adminClient, {
      shop_owner:    shopOwner,
      action:        "reconcile_invoice",
      status:        "skipped",
      quote_id:      quote.id,
      qb_invoice_id: quote.qb_invoice_id,
      response_body: { kind: classification.kind, reason: classification.reason },
    });
    return classification;
  }

  // PAID_NOT_RECORDED → patch + convert. Same logic as refreshInvoice.
  if (classification.kind === DRIFT_KINDS.PAID_NOT_RECORDED) {
    const patch: any = buildQuotePatchFromFreshInvoice(freshInvoice, quote);
    if (patch) {
      await adminClient
        .from("quotes")
        .update(patch)
        .eq("id", quote.id)
        .eq("shop_owner", shopOwner);
    }
    // Re-read so the order row carries the latest fields.
    const { data: latestQuote } = await adminClient
      .from("quotes")
      .select("*")
      .eq("id", quote.id)
      .eq("shop_owner", shopOwner)
      .maybeSingle();
    const orderId = await convertQuoteToOrder(adminClient, latestQuote || quote);

    await logEvent(adminClient, {
      shop_owner:    shopOwner,
      action:        "reconcile_invoice",
      status:        "success",
      quote_id:      quote.id,
      qb_invoice_id: quote.qb_invoice_id,
      response_body: { kind: classification.kind, order_id: orderId },
    });
    await pushNotification(adminClient, shopOwner, quote, classification);

    // Send the same payment-received email the webhook would have sent.
    // This is the "overnight reconcile picked up a missed webhook" case
    // — without this, the shop sees the order materialize but never
    // gets the payment heads-up. Best-effort: a Resend failure must
    // not roll back the conversion or the audit log.
    //
    // Gated on isRecentQbPayment: a PAID_NOT_RECORDED invoice QB last
    // touched months ago is stale history being reconciled, not a fresh
    // payment — convert + record it, but don't email a "Payment received"
    // heads-up for an old invoice (the 2026-07-13 stale-blast guard).
    if (!isRecentQbPayment(freshInvoice)) {
      await logEvent(adminClient, {
        shop_owner:    shopOwner,
        action:        "reconcile_invoice",
        status:        "skipped",
        quote_id:      quote.id,
        qb_invoice_id: quote.qb_invoice_id,
        response_body: { notify_skipped: "stale_payment", last_updated: freshInvoice?.MetaData?.LastUpdatedTime ?? null },
      });
    } else {
      try {
        const q = latestQuote || quote;
        const recipient = chooseQuotePaymentRecipient(q);
        let email: any = null;
        if (recipient) {
          const { data: shopRow } = await adminClient
            .from("shops")
            .select("shop_name")
            .eq("owner_email", shopOwner)
            .maybeSingle();
          email = buildQuotePaymentEmail({
            quote: q, shop: shopRow, customer: null, recipient,
            orderId, amountPaid: q?.total,
          });
        }
        await sendAndLogApprovalNotification(adminClient, {
          shop_owner: shopOwner,
          event_type: "quote_payment",
          quote_id:   q?.id,
          recipient_email: recipient?.to ?? "",
          recipient_role:  recipient?.role,
          to:       recipient?.to,
          subject:  email?.subject,
          html:     email?.html,
          reply_to: email?.reply_to,
        });
      } catch (notifyErr) {
        console.error("[qbReconcile] payment notification failed:", notifyErr);
      }
    }

    return classification;
  }

  // TOTALS_DRIFT / MISSING_IN_QB → notify only. We don't auto-fix:
  // for totals drift, the right answer depends on which side is
  // canonical (QB's value if a tax rate changed; ours if someone
  // edited the line items in QB). MISSING_IN_QB needs operator
  // judgement (delete the link? create a new invoice?).
  await logEvent(adminClient, {
    shop_owner:    shopOwner,
    action:        "reconcile_invoice",
    status:        "skipped",
    quote_id:      quote.id,
    qb_invoice_id: quote.qb_invoice_id,
    response_body: { kind: classification.kind, drift: classification.drift },
  });
  await pushNotification(adminClient, shopOwner, quote, classification);
  return classification;
}

async function pushNotification(adminClient: any, shopOwner: string, quote: any, classification: any) {
  const notif = buildReconcileNotification({ shopOwner, quote, classification });
  if (!notif) return;
  await recordShopNotification(adminClient, {
    shopOwner: notif.shop_owner,
    eventType: notif.event_type,
    severity:  notif.severity,
    title:     notif.title,
    body:      notif.body,
    relatedEntity: notif.related_entity,
    relatedId:     notif.related_id,
    metadata:      notif.metadata,
  });
}

// ── Shop-facing books-drift notifications ───────────────────────────
// For each nightly-verified drift row, tell the SHOP directly (their bell)
// so InkTracker is the one looking out for them — instead of the operator
// being the only one who ever learns their books diverged. Reuses the calm
// buildBooksDriftNotification copy (post-creation drift is usually a QB edit,
// not a bug). Per-quote dedup: skip if that shop already has an UNREAD
// qb_books_drift notice for the same row, so an unresolved drift doesn't
// re-notify every single night. Swallows errors — a failed notification must
// never break reconciliation.
async function notifyShopsOfDrift(adminClient: any, driftRows: any[]): Promise<{ created: number }> {
  let created = 0;
  for (const r of driftRows ?? []) {
    try {
      const shopOwner = r.shop_owner;
      const rowId = r.id;
      if (!shopOwner || !rowId) continue;

      // Dedup: an existing UNREAD drift notice for this exact row means the
      // shop already knows and hasn't acted — don't stack another one.
      const { data: existing } = await adminClient
        .from("notifications")
        .select("id")
        .eq("shop_owner", shopOwner)
        .eq("event_type", "qb_books_drift")
        .eq("related_id", String(rowId))
        .is("read_at", null)
        .limit(1)
        .maybeSingle();
      if (existing) continue;

      const res = await recordShopNotification(
        adminClient,
        buildBooksDriftNotification({
          shopOwner,
          ref: r.ref ?? r.quote_id ?? r.invoice_id,
          rowId,
          qbInvoiceId: r.qb_invoice_id,
          total: r.total,
          qbTotal: r.qb_total,
          drift: r.drift,
          source: r.source ?? "quotes",
        }),
      );
      if (res.ok) created++;
    } catch (err) {
      console.warn("[qbReconcile] shop drift-notify failed:", (err as Error)?.message);
    }
  }
  return { created };
}

// ── Operator alert digest ───────────────────────────────────────────
// Runs once at the start of every cron tick. Queries the last 24h of
// qb_event_log rows with status='error', summarizes by shop + action,
// and emails a digest to OPERATOR_ALERT_EMAIL if the total crosses the
// threshold. Failures here are swallowed — the alert is monitoring,
// not the reconciliation work itself, and a Resend outage must not
// stop the cron.
async function scanAndAlertQbErrors(adminClient: any): Promise<{ scanned: number; alerted: boolean }> {
  if (!OPERATOR_ALERT_EMAIL || !RESEND_API_KEY) {
    return { scanned: 0, alerted: false };
  }
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await adminClient
      .from("qb_event_log")
      .select("shop_owner, action, error_message, created_at, status")
      .eq("status", "error")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.warn("[qbReconcile] error-digest scan failed:", error.message);
      return { scanned: 0, alerted: false };
    }
    const summary = summarizeQbErrors(rows ?? []);
    if (!shouldSendErrorDigest(summary)) {
      return { scanned: summary.total, alerted: false };
    }
    const text = buildQbErrorDigestText(summary);
    const html = buildQbErrorDigestHtml(summary);
    const subject = `[InkTracker] QuickBooks error spike — ${summary.total} event(s) across ${summary.shopCount} shop(s)`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `InkTracker <${ALERT_FROM_EMAIL}>`,
        to: [OPERATOR_ALERT_EMAIL],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[qbReconcile] Resend alert send failed: ${res.status} ${body}`);
      return { scanned: summary.total, alerted: false };
    }
    return { scanned: summary.total, alerted: true };
  } catch (err) {
    console.warn("[qbReconcile] error-digest exception:", (err as Error)?.message);
    return { scanned: 0, alerted: false };
  }
}

// ── Data-integrity alert ────────────────────────────────────────────
// Runs once per cron tick, right after the error digest. Calls the
// data_integrity_violations() SQL function (migration 20260628) and
// emails the operator if ANY quote/order/invoice has a missing or
// dangling customer link. The beloved's orphans sat invisible for ~9
// months because no invariant was watched — this is the alarm that
// was missing. Failures are swallowed: monitoring, not the work.
async function scanAndAlertDataIntegrity(adminClient: any): Promise<{ violations: number; alerted: boolean }> {
  if (!OPERATOR_ALERT_EMAIL || !RESEND_API_KEY) {
    return { violations: 0, alerted: false };
  }
  try {
    const { data: rows, error } = await adminClient.rpc("data_integrity_violations");
    if (error) {
      console.warn("[qbReconcile] integrity scan failed:", error.message);
      return { violations: 0, alerted: false };
    }
    if (!shouldSendIntegrityAlert(rows)) {
      return { violations: 0, alerted: false };
    }
    // Once-per-day dedup. The integrity scan runs on EVERY reconcile call, so
    // multiple runs in a day (manual testing, or a future per-hour cron) would
    // otherwise email the same finding repeatedly — which is exactly what
    // spammed the operator's inbox during cron debugging. Only send if no
    // integrity alert was already logged in the last 24h.
    const { data: recentAlert } = await adminClient
      .from("qb_event_log")
      .select("id")
      .eq("action", "integrity_alert")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recentAlert) {
      return { violations: 0, alerted: false };
    }
    const text = buildIntegrityAlertText(rows);
    const total = (rows ?? []).reduce(
      (s: number, r: any) => s + Number(r.missing_link || 0) + Number(r.dangling_link || 0),
      0,
    );
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `InkTracker <${ALERT_FROM_EMAIL}>`,
        to: [OPERATOR_ALERT_EMAIL],
        subject: `[InkTracker] Data integrity violation — ${total} orphaned customer reference(s)`,
        text,
      }),
    });
    if (!res.ok) {
      console.warn(`[qbReconcile] integrity alert send failed: ${res.status} ${await res.text()}`);
      return { violations: total, alerted: false };
    }
    // Record the send so the 24h dedup above suppresses repeats today.
    await logEvent(adminClient, {
      shop_owner:    "__system__",
      action:        "integrity_alert",
      direction:     "outbound",
      status:        "success",
      response_body: { total },
    });
    return { violations: total, alerted: true };
  } catch (err) {
    console.warn("[qbReconcile] integrity scan exception:", (err as Error)?.message);
    return { violations: 0, alerted: false };
  }
}

// ── Books-drift alert ───────────────────────────────────────────────
// Detects rows whose local money disagrees with QuickBooks (the
// Dragon Head / Thunder House class, 2026-07-17): QB-linked quotes and
// invoices where total ≠ qb_total, plus paid invoices whose linked
// order is still unpaid. Tax-hold firings ride along as context but
// never trigger on their own. 24h dedup via qb_event_log; failures
// swallowed — monitoring, not the work. Pure logic + tests in
// _shared/booksDriftAlert.js.
async function scanAndAlertBooksDrift(adminClient: any, verifiedDrift: any[]): Promise<{ findings: number; alerted: boolean }> {
  if (!OPERATOR_ALERT_EMAIL || !RESEND_API_KEY) return { findings: 0, alerted: false };
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Drift rows arrive PRE-VERIFIED against live QB by each shop's
    // reconcile pass (see the fourth pass in reconcileShop) — a stale
    // qb_total mirror alone can no longer reach this email. First prod
    // firing (2026-07-17) alerted on two Kato invoices that QBO had
    // already corrected; never again.
    const rows = Array.isArray(verifiedDrift) ? verifiedDrift : [];
    const quoteDrift = rows.filter((r: any) => r.source === "quotes");
    const invoiceDrift = rows.filter((r: any) => r.source === "invoices");

    // Paid invoice → unpaid order. No FK between invoices.order_id and
    // orders.order_id, so match in two passes.
    const { data: paidLinked } = await adminClient
      .from("invoices")
      .select("shop_owner, invoice_id, order_id")
      .eq("paid", true)
      .not("order_id", "is", null)
      .limit(5000);
    let stuckOrders: any[] = [];
    const linkedIds = (paidLinked ?? []).map((r: any) => r.order_id);
    if (linkedIds.length) {
      const { data: unpaidOrders } = await adminClient
        .from("orders")
        .select("shop_owner, order_id")
        .eq("paid", false)
        .in("order_id", linkedIds);
      const unpaidKey = new Set((unpaidOrders ?? []).map((o: any) => `${o.shop_owner}|${o.order_id}`));
      stuckOrders = (paidLinked ?? []).filter((r: any) => unpaidKey.has(`${r.shop_owner}|${r.order_id}`));
    }

    const { count: taxHoldCount } = await adminClient
      .from("qb_event_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "create_invoice")
      .eq("response_body->>taxBlocked", "true")
      .gte("created_at", since24h);

    const summary = summarizeBooksDrift({ quoteDrift, invoiceDrift, stuckOrders, taxHoldCount: taxHoldCount ?? 0 });
    if (!shouldSendBooksDriftAlert(summary)) {
      return { findings: 0, alerted: false };
    }

    // Once-per-day dedup, same pattern as the integrity alert.
    const { data: recentAlert } = await adminClient
      .from("qb_event_log")
      .select("id")
      .eq("action", "books_drift_alert")
      .gte("created_at", since24h)
      .limit(1)
      .maybeSingle();
    if (recentAlert) return { findings: summary.driftCount + summary.stuckCount, alerted: false };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `InkTracker <${ALERT_FROM_EMAIL}>`,
        to: [OPERATOR_ALERT_EMAIL],
        subject: `[InkTracker] Books drift — ${summary.driftCount} row(s) disagree with QuickBooks` +
                 (summary.stuckCount ? `, ${summary.stuckCount} stuck paid order(s)` : ""),
        text: buildBooksDriftAlertText(summary),
      }),
    });
    if (!res.ok) {
      console.warn(`[qbReconcile] books-drift alert send failed: ${res.status} ${await res.text()}`);
      return { findings: summary.driftCount + summary.stuckCount, alerted: false };
    }
    await logEvent(adminClient, {
      shop_owner:    "__system__",
      action:        "books_drift_alert",
      direction:     "outbound",
      status:        "success",
      response_body: {
        drift: summary.driftCount,
        stuck: summary.stuckCount,
        shops: summary.shopCount,
        tax_holds_24h: summary.taxHoldCount,
      },
    });
    return { findings: summary.driftCount + summary.stuckCount, alerted: true };
  } catch (err) {
    console.warn("[qbReconcile] books-drift scan exception:", (err as Error)?.message);
    return { findings: 0, alerted: false };
  }
}

// ── Webhook-health alert ────────────────────────────────────────────
// The recurring blind spot: the QB payment webhook silently stops
// delivering (token mismatch, Test/Live toggle, deleted endpoint) and
// nobody knows until a customer says "I paid and nothing happened." The
// nightly reconcile is the safety net — it converts the missed payments —
// and the COUNT of what it had to convert IS the signal the webhook is
// down. This emails the operator so the NEXT drift announces itself
// instead of festering. 24h dedup; benign one-offs stay quiet.
const WEBHOOK_MISS_ALERT_THRESHOLD = 1;

async function alertWebhookHealth(adminClient: any, paidNotRecorded: number): Promise<{ alerted: boolean }> {
  if (!OPERATOR_ALERT_EMAIL || !RESEND_API_KEY) return { alerted: false };
  if (paidNotRecorded < WEBHOOK_MISS_ALERT_THRESHOLD) return { alerted: false };
  try {
    // 24h dedup so a down webhook nudges once/day, not on every run.
    const { data: recent } = await adminClient
      .from("qb_event_log")
      .select("id")
      .eq("action", "webhook_health_alert")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recent) return { alerted: false };

    const subject = `[InkTracker] QuickBooks payment webhook may be down — reconcile cleaned up ${paidNotRecorded} missed payment(s)`;
    const text =
      `Last night's reconcile had to auto-convert ${paidNotRecorded} paid invoice(s) that the QuickBooks ` +
      `payment webhook should have caught in real time.\n\n` +
      `Customers ARE getting their orders started (the reconcile is the backstop) — just up to ~24h late ` +
      `instead of instantly. If this recurs night after night, the QB payment webhook is misconfigured. ` +
      `Verify it in the Intuit Developer portal:\n` +
      `  • Endpoint:  ${SUPABASE_URL}/functions/v1/qbWebhook\n` +
      `  • Subscribed to:  Payment (Create) + Invoice (Update)\n` +
      `  • Verifier token matches the QB_WEBHOOK_VERIFIER_TOKEN secret\n` +
      `  • Production (not sandbox) mode\n\n` +
      `(An occasional single conversion can be normal — e.g. a payment recorded directly in QuickBooks ` +
      `never fires our webhook.)`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `InkTracker <${ALERT_FROM_EMAIL}>`, to: [OPERATOR_ALERT_EMAIL], subject, text }),
    });
    if (!res.ok) {
      console.warn(`[qbReconcile] webhook-health alert send failed: ${res.status} ${await res.text()}`);
      return { alerted: false };
    }
    // Record the send so the 24h dedup above suppresses repeats today.
    await logEvent(adminClient, {
      shop_owner:    "__system__",
      action:        "webhook_health_alert",
      direction:     "outbound",
      status:        "success",
      response_body: { paid_not_recorded: paidNotRecorded },
    });
    return { alerted: true };
  } catch (err) {
    console.warn("[qbReconcile] webhook-health alert exception:", (err as Error)?.message);
    return { alerted: false };
  }
}

// ── Email-delivery health alert ─────────────────────────────────────
// Reads notification_log for the last 24h and emails the OPERATOR when any
// notification send failed. The blind spot this closes: every shop-owner
// notification 403'd silently for a month (June 1 → July 2, 2026) because
// nothing watched the log. OPERATOR-ONLY: the text names shops and secrets
// to check — it must never route to a shop owner, so the recipient is
// strictly OPERATOR_ALERT_EMAIL and the scan skips when that's unset.
// Same shape as the scans above: 24h dedup via qb_event_log, failures
// swallowed (monitoring, not the work).
async function scanAndAlertEmailHealth(adminClient: any): Promise<{ failed: number; alerted: boolean }> {
  if (!OPERATOR_ALERT_EMAIL || !RESEND_API_KEY) return { failed: 0, alerted: false };
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await adminClient
      .from("notification_log")
      .select("status, failure_reason, event_type, shop_owner")
      .gte("created_at", since)
      .limit(500);
    if (error) {
      console.warn("[qbReconcile] email-health scan failed:", error.message);
      return { failed: 0, alerted: false };
    }
    const summary = summarizeNotificationFailures(rows ?? []);
    if (!shouldSendEmailHealthAlert(summary)) {
      return { failed: 0, alerted: false };
    }
    // Once-per-day dedup — a broken sender nudges daily, not per run.
    const { data: recent } = await adminClient
      .from("qb_event_log")
      .select("id")
      .eq("action", "email_health_alert")
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recent) return { failed: summary.failed, alerted: false };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `InkTracker <${ALERT_FROM_EMAIL}>`,
        to: [OPERATOR_ALERT_EMAIL],
        subject: `[InkTracker] Notification emails failing — ${summary.failed} failed send(s) in 24h`,
        text: buildEmailHealthAlertText(summary),
      }),
    });
    if (!res.ok) {
      console.warn(`[qbReconcile] email-health alert send failed: ${res.status} ${await res.text()}`);
      return { failed: summary.failed, alerted: false };
    }
    await logEvent(adminClient, {
      shop_owner:    "__system__",
      action:        "email_health_alert",
      direction:     "outbound",
      status:        "success",
      response_body: { failed: summary.failed, by_reason: summary.byReason },
    });
    return { failed: summary.failed, alerted: true };
  } catch (err) {
    console.warn("[qbReconcile] email-health scan exception:", (err as Error)?.message);
    return { failed: 0, alerted: false };
  }
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Method gate.
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  // CRON_SECRET gate. Without this, the function is a public
  // unauthenticated DB writer. Use a timing-safe compare so the
  // header bytewise short-circuit can't leak character-position
  // timing (defense in depth — the secret is high-entropy anyway).
  const authHeader = req.headers.get("authorization") || "";
  if (!CRON_SECRET || !timingSafeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    return new Response("unauthorized", { status: 401 });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  const startedAt = Date.now();

  // Operator monitoring — runs first so a Resend outage doesn't block
  // reconciliation, and so the alert lands before per-shop work that
  // could itself generate new error rows for tomorrow's digest.
  const alertResult = await scanAndAlertQbErrors(adminClient);
  const integrityResult = await scanAndAlertDataIntegrity(adminClient);
  console.error(`[qbReconcile] integrity: ${integrityResult.violations} violation(s), alerted=${integrityResult.alerted}`);
  const emailHealth = await scanAndAlertEmailHealth(adminClient);
  console.error(`[qbReconcile] email-health: ${emailHealth.failed} failed send(s) in 24h, alerted=${emailHealth.alerted}`);

  try {
    // Find every profile with QB connected, LEAST-recently-reconciled
    // first (never-reconciled at the very front). Combined with the time
    // budget below this makes the run self-sharding: shops the budget
    // doesn't reach tonight keep their older stamp and lead tomorrow's
    // run, so no shop can starve as shop count grows — the old
    // iterate-everything loop just hit the edge wall-clock cap and
    // silently dropped the tail.
    const { data: secretRows, error: secretErr } = await adminClient
      .from("profile_secrets")
      .select("profile_id, qb_last_reconciled_at")
      .not("qb_access_token", "is", null)
      .not("qb_realm_id",     "is", null)
      .order("qb_last_reconciled_at", { ascending: true, nullsFirst: true });
    if (secretErr) {
      return Response.json({ error: `profile_secrets query: ${secretErr.message}` }, { status: 500 });
    }
    const profileIds = (secretRows ?? []).map((r: any) => r.profile_id).filter(Boolean);

    // Stop starting new shops once the budget is spent — safely under the
    // edge function CPU/wall-clock cap, leaving headroom for the shop in
    // flight to finish plus the digest/rollup writes after the loop.
    const TIME_BUDGET_MS = Number(Deno.env.get("QB_RECONCILE_BUDGET_MS")) || 100_000;

    const shopResults: any[] = [];
    let shopsSkipped = 0;
    for (const profileId of profileIds) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        shopsSkipped = profileIds.length - shopResults.length;
        console.error(`[qbReconcile] time budget spent — deferring ${shopsSkipped} shop(s) to the next run`);
        break;
      }
      try {
        const profile = await loadProfileWithSecrets(adminClient, { id: profileId });
        // Owners have shop_owner=NULL (keyed by email) — accept shop_owner || email.
        if (!profile?.qb_access_token || !(profile?.shop_owner || profile?.email)) continue;
        // Skip non-shop roles (brokers can have personal QB tokens but
        // their quotes flow through the shop's tenant).
        if (profile.role && !["shop", "admin", "manager"].includes(profile.role)) continue;
        const result = await reconcileShop(adminClient, profile);
        shopResults.push(result);
      } catch (err) {
        shopResults.push({ profileId, error: (err as Error)?.message });
      }
      // Stamp even on error — a shop whose reconcile throws every night
      // must not pin itself to the front of the queue and starve the rest.
      // The per-shop error lands in shopResults/the rollup for operators.
      await adminClient
        .from("profile_secrets")
        .update({ qb_last_reconciled_at: new Date().toISOString() })
        .eq("profile_id", profileId);
    }

    const allClassifications = shopResults.flatMap((s: any) => s.classifications ?? []);
    const summary = summarizeReconciliation(allClassifications);
    const durationMs = Date.now() - startedAt;

    // If the reconcile had to clean up payments the webhook missed, that's
    // the signal the QB payment webhook is down — alert the operator.
    const webhookHealth = await alertWebhookHealth(adminClient, summary.paid_not_recorded);

    // Books-drift alert — fed by the per-shop live-verified drift rows
    // (runs after the shop loop because verification needs each shop's
    // QB token inside reconcileShop).
    const verifiedDrift = shopResults.flatMap((s: any) => s.driftRows ?? []);
    // Tell each affected SHOP directly (in-app bell) — InkTracker looking out
    // for them. Runs before the operator digest; both channels fire.
    const shopNotified = await notifyShopsOfDrift(adminClient, verifiedDrift);
    const booksDrift = await scanAndAlertBooksDrift(adminClient, verifiedDrift);
    console.error(`[qbReconcile] books-drift: ${booksDrift.findings} finding(s), operator-alerted=${booksDrift.alerted}, shops-notified=${shopNotified.created}`);

    // Log one rollup row per cron run so operators can see "did
    // reconciliation actually run last night?" without scrolling
    // through per-quote rows. shop_owner='__system__' marks it as
    // not tied to any tenant.
    await logEvent(adminClient, {
      shop_owner:   "__system__",
      action:       "reconcile_run",
      direction:    "outbound",
      status:       summary.errors > 0 ? "error" : "success",
      response_body: {
        shops: shopResults.length,
        shops_skipped: shopsSkipped,
        summary,
        duration_ms: durationMs,
      },
      duration_ms: durationMs,
    });

    return Response.json({
      ok:       true,
      shops:    shopResults.length,
      shops_skipped: shopsSkipped,
      summary,
      duration_ms: durationMs,
      alert:    alertResult,
      webhook_health: webhookHealth,
      books_drift: booksDrift,
      shops_notified: shopNotified.created,
    });
  } catch (err) {
    await captureError(err, { fn: "qbReconcile" });
    console.error("[qbReconcile] fatal:", err);
    return Response.json(
      { error: (err as Error)?.message || "reconcile failed" },
      { status: 500 },
    );
  }
});
