// QuickBooks webhook receiver
// QB POSTs signed payloads here when invoices are paid.
// Auto-converts the corresponding InkTracker quote to an order.
//
// QB webhook payload shape:
// { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name, id, operation, lastUpdated }] } }] }
//
// Deploy: npx supabase functions deploy qbWebhook --no-verify-jwt

import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { refreshQbTokenSerialized } from "../_shared/qbTokenLock.js";
import { decideTokenRefresh, buildRefreshedTokenFields } from "../_shared/connectionLogic.js";
import { captureError } from "../_shared/observability.ts";
import { claimWebhookEventDetailed, releaseWebhookEvent, CLAIM_OUTCOMES, extractQbEventId } from "../_shared/webhookIdempotency.js";
import { logEvent } from "../_shared/qbAudit.js";
import { verifyQbSignature } from "../_shared/qbWebhookSignature.js";
import { convertQuoteToOrder } from "../_shared/qbConvertQuote.js";
import {
  chooseQuotePaymentRecipient,
  buildQuotePaymentEmail,
  sendAndLogApprovalNotification,
} from "../_shared/approvalNotificationEmail.js";
import {
  buildPaidInvoiceQuery,
  buildPaidInvoiceQueryFromInvoices,
  cascadeMarkLinkedPaid,
  cascadeMarkInvoicePaid,
  decidePaidInvoiceAction,
  extractInvoiceIdsFromPayment,
  isInvoiceFullyPaid,
  PAID_INVOICE_ACTIONS,
} from "../_shared/qbWebhookLogic.js";
import {
  detectQbInvoiceModification,
  buildQbMirrorPatch,
  buildQbLineSnapshot,
  buildQbModifiedNotification,
} from "../_shared/qbInvoiceModified.js";
import { recordShopNotification } from "../_shared/shopNotifications.js";
// Set secret: npx supabase secrets set QB_WEBHOOK_VERIFIER_TOKEN=<from Intuit Developer Portal>

import { createClient } from "npm:@supabase/supabase-js@2.102.1";

const QB_BASE               = "https://quickbooks.api.intuit.com/v3/company";
const QB_VERIFIER_TOKEN     = Deno.env.get("QB_WEBHOOK_VERIFIER_TOKEN") ?? "";
const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Loud, one-shot startup warning when the verifier token isn't set.
// Without it, every webhook request fails signature verification and
// returns 401, which means QB retries with exponential backoff until
// it gives up — and we'd see no payment-driven quote→order conversions
// at all. Before this log, the misconfiguration only surfaced as silent
// failed deliveries inside Intuit's webhook dashboard.
if (!QB_VERIFIER_TOKEN) {
  console.error(
    "[qbWebhook] FATAL CONFIG: QB_WEBHOOK_VERIFIER_TOKEN is not set. " +
    "All incoming QB webhooks will fail signature verification → no " +
    "automatic quote/order conversion on customer payment. " +
    "Set it via `npx supabase secrets set QB_WEBHOOK_VERIFIER_TOKEN=...`."
  );
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, intuit-signature",
};

// ── Signature verification ───────────────────────────────────────────────────
// Logic lives in ../_shared/qbWebhookSignature.js (unit-tested + reused by the
// smoke script). This thin wrapper binds it to the configured verifier token.
function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  return verifyQbSignature(rawBody, signature, QB_VERIFIER_TOKEN);
}

// ── QB API helpers ───────────────────────────────────────────────────────────

async function qbGet(accessToken: string, realmId: string, path: string) {
  const url = `${QB_BASE}/${realmId}/${path}?minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QB GET ${path} failed: ${res.status}`);
  return res.json();
}

// ── Token refresh ────────────────────────────────────────────────────────────

const QB_CLIENT_ID     = Deno.env.get("QB_CLIENT_ID")     ?? "";
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET") ?? "";
const QB_TOKEN_URL     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function refreshQbAccessToken(refreshTok: string) {
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshTok }),
  });
  if (!res.ok) {
    console.error(`[qbWebhook] Token refresh failed: ${res.status}`);
    throw new Error("QuickBooks connection expired. Please reconnect in Account settings.");
  }
  return res.json();
}

async function getAccessToken(supabase: any, profile: any): Promise<string> {
  // Refresh (when near expiry) under the SHARED DB lease lock so a webhook and a
  // concurrent qbSync/qbReconcile refresh don't both POST the rotating refresh
  // token and clobber it (the "QB randomly disconnected" bug). Same serialized
  // path the other QB functions use.
  const { accessToken } = await refreshQbTokenSerialized(supabase, profile, {
    decideRefresh: decideTokenRefresh,
    refreshFn: refreshQbAccessToken,
    buildFields: buildRefreshedTokenFields,
    persist: (id: string, fields: any) => updateProfileSecrets(supabase, id, fields),
    reload: (id: string) => loadProfileWithSecrets(supabase, { id }),
  });
  return accessToken;
}

// ── Core: find quote by QB invoice ID and mark paid ──────────────────────────

// Mirror a QB-side invoice edit onto the linked local rows (quotes +
// invoices, matched by qb_invoice_id within the tenant) and notify the
// shop when the edit created NEW disagreement with the as-sold total.
// Notify-on-transition only: redelivered webhooks and edits that bring
// QB into agreement stay silent. One notification per event, preferring
// the invoice row (that's where the Sync button lives).
async function mirrorQbInvoiceEdit(supabase: any, freshInvoice: any, qbInvoiceId: string, shopOwner: string) {
  if (!freshInvoice) return;
  const freshQbTotal = Number(freshInvoice.TotalAmt ?? 0);

  const [{ data: quote }, { data: invoiceRow }] = await Promise.all([
    supabase.from("quotes")
      .select("id, quote_id, total, qb_total, qb_line_snapshot, paid")
      .eq("qb_invoice_id", qbInvoiceId).eq("shop_owner", shopOwner).maybeSingle(),
    supabase.from("invoices")
      .select("id, invoice_id, total, qb_total, qb_line_snapshot, paid")
      .eq("qb_invoice_id", qbInvoiceId).eq("shop_owner", shopOwner).maybeSingle(),
  ]);
  if (!quote && !invoiceRow) return; // not an InkTracker-linked invoice

  // Built once per event — the same QB line state is compared against
  // each linked row's own prior snapshot.
  const freshLines = buildQbLineSnapshot(freshInvoice);

  let notified = false;
  for (const [table, row] of [["invoices", invoiceRow], ["quotes", quote]] as const) {
    if (!row) continue;
    const detection = detectQbInvoiceModification({
      localTotal: row.total,
      priorQbTotal: row.qb_total,
      freshQbTotal,
      priorLines: (row as any).qb_line_snapshot ?? null,
      freshLines,
    });
    const patch = buildQbMirrorPatch(freshInvoice, row);
    if (patch) {
      const { error: patchErr } = await supabase.from(table).update(patch)
        .eq("id", row.id).eq("shop_owner", shopOwner);
      if (patchErr) console.error(`[qbWebhook] qb mirror patch failed on ${table} for ${qbInvoiceId}:`, patchErr.message);
    }
    if (detection.shouldNotify && !notified) {
      notified = true;
      await recordShopNotification(supabase, buildQbModifiedNotification({
        shopOwner,
        ref: (table === "invoices" ? (row as any).invoice_id : (row as any).quote_id) || `QB #${qbInvoiceId}`,
        rowId: row.id,
        relatedEntity: table === "invoices" ? "invoice" : "quote",
        qbInvoiceId,
        localTotal: row.total,
        freshQbTotal,
        lineChanges: detection.lineChanges,
        totalDiverges: detection.diverges,
      }));
      await logEvent(supabase, {
        shop_owner: shopOwner,
        action: "qb_invoice_modified",
        direction: "inbound",
        status: "success",
        qb_invoice_id: qbInvoiceId,
        response_body: {
          local_total: row.total,
          qb_total: freshQbTotal,
          table,
          line_changes: detection.lineChanges,
        },
      });
    }
  }
}

async function handlePaidInvoice(supabase: any, qbInvoiceId: string, shopOwner: string) {
  // CRITICAL: scope the lookup by BOTH qb_invoice_id and shop_owner.
  // QB invoice ids are realm-scoped (not globally unique), so without
  // the shop_owner filter a webhook for Shop B's invoice 1042 could
  // match — and convert — Shop A's quote 1042. See qbWebhookLogic.js
  // for the full rationale.
  const { data: quote, error } = await buildPaidInvoiceQuery(supabase, qbInvoiceId, shopOwner);

  if (error) {
    console.error(`[qbWebhook] DB error looking up invoice ${qbInvoiceId} for ${shopOwner}: ${error.message}`);
    await logEvent(supabase, {
      shop_owner: shopOwner,
      action: "webhook_paid_invoice",
      status: "error",
      qb_invoice_id: qbInvoiceId,
      error_message: `quote lookup failed: ${error.message}`,
    });
    return;
  }

  // UTC date for paid_date stamping. The webhook runs in a server context
  // without shop timezone — accepting ~24h precision on paid_date is the
  // tradeoff. Operator can fix in QB if exact-day-of-payment matters.
  const today = new Date().toISOString().slice(0, 10);

  const decision = decidePaidInvoiceAction(quote);

  // First-payment path — unchanged from the original implementation.
  if (decision.action === PAID_INVOICE_ACTIONS.CONVERT) {
    console.error(`[qbWebhook] Marking quote ${quote.quote_id} as paid and converting to order`);
    const orderId = await convertQuoteToOrder(supabase, quote);
    console.error(`[qbWebhook] Quote ${quote.quote_id} → Order ${orderId}`);
    await logEvent(supabase, {
      shop_owner: shopOwner,
      action: "webhook_paid_invoice",
      status: "success",
      qb_invoice_id: qbInvoiceId,
      quote_id: quote.id,
      response_body: { converted: true, quote_id_human: quote.quote_id, order_id: orderId },
    });
    await sendPaymentNotification(supabase, quote, orderId);
    return;
  }

  // New path: quote was converted manually (or auto-) BEFORE payment.
  // Customer eventually paid; walk quote → order → invoice and mark
  // each paid. Same notification email as the CONVERT path.
  if (decision.action === PAID_INVOICE_ACTIONS.MARK_LINKED_PAID) {
    const updates = await cascadeMarkLinkedPaid(supabase, quote, today);
    console.error(
      `[qbWebhook] Cascade-marked paid: quote ${quote.quote_id} ${JSON.stringify(updates)}`,
    );
    await logEvent(supabase, {
      shop_owner: shopOwner,
      action: "webhook_paid_invoice",
      status: "success",
      qb_invoice_id: qbInvoiceId,
      quote_id: quote.id,
      response_body: { cascade: true, ...updates },
    });
    // Only notify if something was newly flipped — re-deliveries of the
    // same webhook event would otherwise spam the shop owner.
    if (updates.quoteUpdated || updates.orderUpdated || updates.invoiceUpdated) {
      await sendPaymentNotification(supabase, quote, quote.converted_order_id);
    }
    return;
  }

  // Quote not found → fall back to the invoices table. Covers the path
  // where an order was completed without going through Send Quote
  // (runOrderCompletion created the invoice independently). Same
  // cross-tenant scoping rule.
  if (decision.action === PAID_INVOICE_ACTIONS.SKIP_NOT_FOUND) {
    const { data: invoice, error: invErr } = await buildPaidInvoiceQueryFromInvoices(
      supabase, qbInvoiceId, shopOwner,
    );
    if (invErr) {
      console.error(`[qbWebhook] DB error in invoice lookup ${qbInvoiceId}: ${invErr.message}`);
      await logEvent(supabase, {
        shop_owner: shopOwner,
        action: "webhook_paid_invoice",
        status: "error",
        qb_invoice_id: qbInvoiceId,
        error_message: `invoice lookup failed: ${invErr.message}`,
      });
      return;
    }
    if (!invoice) {
      console.error(`[qbWebhook] invoice ${qbInvoiceId} for ${shopOwner}: no quote AND no invoice match`);
      await logEvent(supabase, {
        shop_owner: shopOwner,
        action: "webhook_paid_invoice",
        status: "skipped",
        qb_invoice_id: qbInvoiceId,
        response_body: { decision: "no_match_in_quotes_or_invoices" },
      });
      return;
    }
    const updates = await cascadeMarkInvoicePaid(supabase, invoice, today);
    console.error(
      `[qbWebhook] Cascade-marked invoice paid: ${invoice.invoice_id ?? invoice.id} ${JSON.stringify(updates)}`,
    );
    await logEvent(supabase, {
      shop_owner: shopOwner,
      action: "webhook_paid_invoice",
      status: "success",
      qb_invoice_id: qbInvoiceId,
      response_body: { cascade: "invoice", ...updates },
    });
    // No matching quote means no payment recipient — skip notification.
    // The shop will see the paid status flip in their list view.
    return;
  }

  // All other skip cases: SKIP_ALREADY_CONVERTED (already paid),
  // SKIP_INVALID_QUOTE. Log + return.
  console.error(`[qbWebhook] invoice ${qbInvoiceId} for ${shopOwner}: ${decision.action} — ${decision.reason}`);
  await logEvent(supabase, {
    shop_owner: shopOwner,
    action: "webhook_paid_invoice",
    status: "skipped",
    qb_invoice_id: qbInvoiceId,
    quote_id: quote?.id ?? null,
    response_body: { decision: decision.action, reason: decision.reason },
  });
}

// Helper: payment-received notification email. Extracted from the
// CONVERT path so the new MARK_LINKED_PAID path can call it too without
// drift. Best-effort: a Resend failure must never block the cascade or
// the conversion that already committed.
async function sendPaymentNotification(supabase: any, quote: any, orderId: string | null) {
  try {
    const recipient = chooseQuotePaymentRecipient(quote);
    let email: any = null;
    if (recipient) {
      const { data: shopRow } = await supabase
        .from("shops")
        .select("shop_name")
        .eq("owner_email", quote.shop_owner)
        .maybeSingle();
      email = buildQuotePaymentEmail({
        quote, shop: shopRow, customer: null, recipient,
        orderId, amountPaid: quote.total,
      });
    }
    await sendAndLogApprovalNotification(supabase, {
      shop_owner: quote.shop_owner,
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
    console.error("[qbWebhook] payment notification failed:", notifyErr);
  }
}

// ── Process one notification ─────────────────────────────────────────────────

async function processNotification(supabase: any, notification: any) {
  const { realmId, dataChangeEvent } = notification;
  if (!realmId || !dataChangeEvent?.entities) return;

  // Look up the shop by realm ID. CRITICAL: qb_realm_id lives in
  // `profile_secrets` (moved off `profiles` in the secrets migration), so we
  // MUST query it there. Querying `profiles.qb_realm_id` raises 42703 (column
  // does not exist); the error was swallowed, profileRow came back null, and
  // EVERY real webhook returned "No profile found" — so no paid invoice ever
  // converted, even though QB was delivering Payment/Invoice events correctly.
  // Same bug class as the billing webhook fix.
  // Use maybeSingle-free select: if the SAME QBO company is connected from two
  // InkTracker accounts, two profile_secrets rows share the realm and
  // .maybeSingle() would ERROR (and, swallowed, drop every webhook for that
  // realm as "No profile found"). Take the first row with a live token.
  const { data: secretRows } = await supabase
    .from("profile_secrets")
    .select("profile_id")
    .eq("qb_realm_id", realmId)
    .limit(5);
  let profile: any = null;
  for (const row of secretRows ?? []) {
    const p = await loadProfileWithSecrets(supabase, { id: row.profile_id });
    if (p?.qb_access_token) { profile = p; break; }
  }

  if (!profile?.qb_access_token) {
    console.error(`[qbWebhook] No profile with a live token found for realmId ${realmId}`);
    return;
  }
  // Resolve the shop-owner KEY the quotes/orders are scoped by. For an OWNER
  // (role shop/admin) `profiles.shop_owner` is NULL — they're identified by
  // their own email, and their rows carry `shop_owner = their email`. Only
  // employees/brokers have shop_owner pointing at the owner. So the canonical
  // key is `shop_owner || email`. Reading the bare `shop_owner` here made the
  // handler refuse EVERY owner's payment (shop_owner null) even after the
  // realm→profile lookup was fixed — so nothing converted. We still refuse if
  // BOTH are somehow null (can't safely scope a tenant query).
  const shopOwner: string = profile.shop_owner || profile.email;
  if (!shopOwner) {
    console.error(`[qbWebhook] Profile for realmId ${realmId} has no shop_owner or email — refusing to process`);
    return;
  }

  const accessToken = await getAccessToken(supabase, profile);

  for (const entity of dataChangeEvent.entities) {
    try {
      if (entity.name === "Payment" && entity.operation === "Create") {
        // Fetch the payment to find which invoices it touched, then verify
        // each invoice's Balance is actually 0 before flipping local state.
        // A PARTIAL "Receive payment" in QBO fires this event too — treating
        // it as fully paid marked the order/invoice paid locally while QB
        // still showed an open balance, so the remainder was silently never
        // collected (and an unconverted quote converted on a part-payment).
        const data = await qbGet(accessToken, realmId, `payment/${entity.id}`);
        const invoiceIds = extractInvoiceIdsFromPayment(data?.Payment);
        for (const invId of invoiceIds) {
          const invData = await qbGet(accessToken, realmId, `invoice/${invId}`);
          if (isInvoiceFullyPaid(invData?.Invoice)) {
            await handlePaidInvoice(supabase, invId, shopOwner);
          } else {
            console.error(`[qbWebhook] Payment ${entity.id} left invoice ${invId} with an open balance — not marking paid locally`);
          }
        }
      }

      if (entity.name === "Invoice" && entity.operation === "Update") {
        // Fetch the invoice to check if Balance = 0 (fully paid)
        const data = await qbGet(accessToken, realmId, `invoice/${entity.id}`);
        if (isInvoiceFullyPaid(data?.Invoice)) {
          await handlePaidInvoice(supabase, entity.id, shopOwner);
        }
        // QB-side EDIT propagation. We used to fetch the fresh invoice
        // and discard everything but paid state — edited amounts then
        // coasted invisibly until the nightly reconcile. Mirror the
        // fresh numbers onto the linked rows' qb_* columns now, and if
        // the edit makes QB disagree with the as-sold total, notify the
        // shop in-app ("modified in QuickBooks — sync?"). As-sold
        // totals are never rewritten here; the shop consents via the
        // Sync from QuickBooks button. Best-effort: must never break
        // the webhook.
        try {
          await mirrorQbInvoiceEdit(supabase, data?.Invoice, entity.id, shopOwner);
        } catch (mirrorErr) {
          console.error(`[qbWebhook] edit mirror failed for invoice ${entity.id}:`, mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr));
        }
      }
    } catch (err) {
      console.error(`[qbWebhook] Error processing entity ${entity.name}/${entity.id}:`, err instanceof Error ? err.message : String(err));
    }
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // QB sends a GET to verify the endpoint is reachable on initial setup
  if (req.method === "GET") {
    return new Response("ok", { status: 200, headers: CORS });
  }

  try {
    const rawBody = await req.text();

    // Verify HMAC signature if a verifier token is configured
    const signature = req.headers.get("intuit-signature") ?? "";
    const valid = await verifySignature(rawBody, signature);
    if (!valid) {
      console.error("[qbWebhook] Signature verification failed");
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    const body = JSON.parse(rawBody);
    const notifications = body?.eventNotifications ?? [];

    // Service-role client for cross-user operations
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Idempotency. QB can re-deliver the same payload on transient
    // failures; processing notifications twice would over-sync data
    // (e.g. duplicate quote→order conversions). Tests CW1–CW6 +
    // WQ1–WQ5 in _shared/__tests__/webhookIdempotency.test.js.
    //
    // We use the DETAILED variant so a transient DB error returns 503
    // (QB retries with exponential backoff) instead of 200 (QB treats
    // as delivered and never retries). Pre-detailed behavior silently
    // dropped events when processed_webhook_events was briefly
    // unhealthy — same class of "everything looks fine, no events
    // arrive" bug as a missing webhook signing key.
    const dedupId = extractQbEventId(body);
    const claim = await claimWebhookEventDetailed(supabase, "qb", dedupId as string, body);
    if (claim.status === CLAIM_OUTCOMES.DUPLICATE) {
      console.log(`[qbWebhook] Duplicate event ${dedupId} — skipping`);
      return new Response("ok", { status: 200, headers: CORS });
    }
    if (claim.status === CLAIM_OUTCOMES.ERROR) {
      console.error(`[qbWebhook] DB error during idempotency claim ${dedupId} — returning 503 so QB retries`);
      return new Response("idempotency store unavailable", { status: 503, headers: CORS });
    }

    // Bounded concurrency (was an uncapped Promise.all). Each notification
    // can trigger QB API calls + a Resend send; a large multi-entity batch
    // fanning out simultaneously is the exact shape that trips Resend's
    // ~2 req/s account limit and spikes concurrent QB token refreshes.
    //
    // Two-phase idempotency (see _shared/webhookIdempotency.js): the claim
    // above is only a commit once this work succeeds. If a notification
    // throws (e.g. token refresh hiccup in processNotification, before its
    // per-entity try/catch), RELEASE the claim and return 503 so QB
    // redelivers — otherwise the payment event is permanently dropped from
    // real-time processing and only the nightly reconcile rescues it, up
    // to ~24h late. Per-entity errors are still swallowed inside
    // processNotification by design; the redelivered batch is safe to
    // re-run because conversion/cascade steps are individually gated.
    try {
      const NOTIFICATION_CONCURRENCY = 2;
      for (let i = 0; i < notifications.length; i += NOTIFICATION_CONCURRENCY) {
        await Promise.all(
          notifications
            .slice(i, i + NOTIFICATION_CONCURRENCY)
            .map((n: any) => processNotification(supabase, n)),
        );
      }
    } catch (procErr) {
      await captureError(procErr, { fn: "qbWebhook", phase: "processNotification" });
      console.error(`[qbWebhook] Processing failed after claim ${dedupId} — releasing claim, asking QB to redeliver`);
      await releaseWebhookEvent(supabase, "qb", dedupId as string);
      return new Response("processing failed, retry", { status: 503, headers: CORS });
    }

    // QB expects a 200 response to confirm receipt
    return new Response("ok", { status: 200, headers: CORS });
  } catch (err) {
    await captureError(err, { fn: "qbWebhook" });
    console.error("[qbWebhook] Error:", err);
    // Still return 200 so QB doesn't keep retrying on parse errors
    return new Response("ok", { status: 200, headers: CORS });
  }
});
