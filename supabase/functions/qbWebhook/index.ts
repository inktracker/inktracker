// QuickBooks webhook receiver
// QB POSTs signed payloads here when invoices are paid.
// Auto-converts the corresponding InkTracker quote to an order.
//
// QB webhook payload shape:
// { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name, id, operation, lastUpdated }] } }] }
//
// Deploy: npx supabase functions deploy qbWebhook --no-verify-jwt

import { loadProfileWithSecrets, updateProfileSecrets } from "../_shared/profileSecrets.ts";
import { claimWebhookEventDetailed, CLAIM_OUTCOMES, extractQbEventId } from "../_shared/webhookIdempotency.js";
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
// Set secret: npx supabase secrets set QB_WEBHOOK_VERIFIER_TOKEN=<from Intuit Developer Portal>

import { createClient } from "npm:@supabase/supabase-js@2";

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

async function getAccessToken(supabase: any, profile: any): Promise<string> {
  const expiresAt = new Date(profile.qb_token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) return profile.qb_access_token;

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: profile.qb_refresh_token }),
  });
  if (!res.ok) {
    console.error(`[qbWebhook] Token refresh failed: ${res.status}`);
    throw new Error("QuickBooks connection expired. Please reconnect in Account settings.");
  }
  const fresh = await res.json();

  await updateProfileSecrets(supabase, profile.id, {
    qb_access_token:     fresh.access_token,
    qb_refresh_token:    fresh.refresh_token ?? profile.qb_refresh_token,
    qb_token_expires_at: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  });

  return fresh.access_token;
}

// ── Core: find quote by QB invoice ID and mark paid ──────────────────────────

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
  const { data: secretRow } = await supabase
    .from("profile_secrets")
    .select("profile_id")
    .eq("qb_realm_id", realmId)
    .maybeSingle();
  const profile = secretRow ? await loadProfileWithSecrets(supabase, { id: secretRow.profile_id }) : null;

  if (!profile?.qb_access_token) {
    console.error(`[qbWebhook] No profile found for realmId ${realmId}`);
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
        // Fetch the payment to find which invoices it paid
        const data = await qbGet(accessToken, realmId, `payment/${entity.id}`);
        const invoiceIds = extractInvoiceIdsFromPayment(data?.Payment);
        for (const invId of invoiceIds) {
          await handlePaidInvoice(supabase, invId, shopOwner);
        }
      }

      if (entity.name === "Invoice" && entity.operation === "Update") {
        // Fetch the invoice to check if Balance = 0 (fully paid)
        const data = await qbGet(accessToken, realmId, `invoice/${entity.id}`);
        if (isInvoiceFullyPaid(data?.Invoice)) {
          await handlePaidInvoice(supabase, entity.id, shopOwner);
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

    await Promise.all(notifications.map((n: any) => processNotification(supabase, n)));

    // QB expects a 200 response to confirm receipt
    return new Response("ok", { status: 200, headers: CORS });
  } catch (err) {
    console.error("[qbWebhook] Error:", err);
    // Still return 200 so QB doesn't keep retrying on parse errors
    return new Response("ok", { status: 200, headers: CORS });
  }
});
