// Rainforest webhook — Supabase Edge Function (public, no JWT).
//
// Records every payment event in processor_payments and books successful
// payments into the shop's QuickBooks as a Payment against the invoice.
// QuickBooks' own webhook then runs the existing paid pipeline (qbWebhook).
//
// Order of operations, each step fail-safe:
//   1. Verify the signature on the RAW body (Svix scheme) → else 401.
//   2. Route the event (rainforestWebhookAdapter). Non-actionable → 200.
//   3. Claim it in processed_webhook_events (source 'rainforest', key =
//      resource id + event type). Duplicate → 200. DB unhealthy → 503.
//   4. Apply: merchant status, or planPayinEffect → ledger, notification,
//      QB post. Any throw → release the claim and 500 so Rainforest retries
//      (≈28h schedule).
//
// Runs even with RAINFOREST_ENABLED off: that switch stops NEW payments;
// money already taken must still be recorded and booked.
//
// Secrets: RAINFOREST_WEBHOOK_SECRET (whsec_… from the Portal endpoint),
// RAINFOREST_API_KEY, RAINFOREST_API_BASE (sandbox/prod).

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  verifyWebhookSignature,
  routeWebhook,
  webhookDedupeKey,
  payinToEvent,
  refundKind,
} from "../_shared/rainforestWebhookAdapter.js";
import { planPayinEffect, planQbApplication } from "../_shared/rainforestPayinEffect.js";
import { platformFeeCents } from "../_shared/rainforestPricing.js";
import { buildQbPaymentBody, pickQbPaymentMethod } from "../_shared/rainforestQbBooks.js";
import {
  claimWebhookEventDetailed,
  releaseWebhookEvent,
  CLAIM_OUTCOMES,
} from "../_shared/webhookIdempotency.js";
import { insertShopNotification } from "../_shared/notifications.js";
import { captureError } from "../_shared/observability.ts";
import {
  getShopQb,
  qbGetInvoice,
  qbListPaymentMethods,
  qbFindPaymentByRef,
  qbPost,
  type QbConn,
} from "../_shared/qbShopClient.ts";

const SOURCE = "rainforest";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_POST_CLAIM_MS = 10 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Any = any;

export type Deps = {
  admin: Any;
  env: (k: string) => string | undefined;
  rainforestGet: (path: string) => Promise<Any>;
  qb: {
    connect: (shopOwner: string) => Promise<QbConn | null>;
    getInvoice: (c: QbConn, id: string) => Promise<Any | null>;
    paymentMethods: (c: QbConn) => Promise<Any[]>;
    findPaymentByRef: (c: QbConn, ref: string) => Promise<Any | null>;
    postPayment: (c: QbConn, body: unknown) => Promise<Any>;
  };
  now?: () => Date;
};

const ok = (body: unknown = { ok: true }, status = 200) => Response.json(body, { status });

// deno-lint-ignore no-explicit-any
function opsAlert(message: string, context: Record<string, unknown> = {}) {
  console.error(`[rainforestWebhook] ${message}`, context);
  captureError(new Error(message), { fn: "rainforestWebhook", ...context }).catch(() => {});
}

async function loadDoc(admin: Any, md: Any) {
  const id = String(md?.inktracker_quote_id ?? "");
  if (!UUID_RE.test(id)) return null;
  if (md?.inktracker_doc_type === "invoice") {
    const { data } = await admin.from("invoices").select("id, invoice_id, shop_owner, qb_invoice_id").eq("id", id).maybeSingle();
    return data ?? null;
  }
  const { data } = await admin.from("quotes")
    .select("id, quote_id, shop_owner, qb_invoice_id, qb_deposit_invoice_id")
    .eq("id", id).maybeSingle();
  return data ?? null;
}

/**
 * Post the QB Payment for one ledger row, exactly once. Returns a short
 * outcome string for logs/tests. Throws on transient failures (→ retry).
 */
export async function postQbPaymentOnce(deps: Deps, payinId: string): Promise<string> {
  const { admin } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const staleBefore = new Date(now.getTime() - STALE_POST_CLAIM_MS).toISOString();

  // Claim: only one worker posts. Rows already posted, or freshly claimed by
  // another worker, don't match.
  const { data: rows, error: claimErr } = await admin.from("processor_payments")
    .update({ qb_posting_at: now.toISOString() })
    .eq("processor_payin_id", payinId)
    .is("qb_payment_id", null)
    .or(`qb_posting_at.is.null,qb_posting_at.lt."${staleBefore}"`)
    .select("processor_payin_id, shop_owner, qb_invoice_id, amount_cents, platform_fee_cents, method, pay_kind, last_event_at, quote_id, invoice_id");
  if (claimErr) throw new Error(`ledger claim failed: ${claimErr.message}`);
  const row = rows?.[0];
  if (!row) return "not_claimed";

  // Query builders are thenable but have no .catch — always await in a try.
  const release = async (patch: Record<string, unknown>) => {
    try {
      const { error } = await admin.from("processor_payments").update({ qb_posting_at: null, ...patch }).eq("processor_payin_id", payinId);
      if (error) opsAlert(`ledger release failed for ${payinId}`, { error: error.message });
    } catch (e) {
      opsAlert(`ledger release threw for ${payinId}`, { error: String(e) });
    }
  };

  try {
    const conn = await deps.qb.connect(row.shop_owner);
    if (!conn) {
      await release({ qb_post_error: "QuickBooks not connected" });
      await insertShopNotification(admin, {
        shopOwner: row.shop_owner,
        eventType: "payment_not_booked",
        severity: "alert",
        title: `Payment received but not recorded in QuickBooks: $${(row.amount_cents / 100).toFixed(2)}`,
        body: `QuickBooks isn't connected, so this online payment couldn't be recorded on invoice #${row.qb_invoice_id}. Reconnect QuickBooks in Account settings, then record the payment on that invoice in QuickBooks.`,
        metadata: { processor: SOURCE, payin_id: payinId },
      });
      return "no_qb_connection";
    }

    // Already in QuickBooks (e.g. a crash after posting, before our write)?
    const ref = String(payinId).slice(-21);
    let existing = null;
    try { existing = await deps.qb.findPaymentByRef(conn, ref); } catch { /* not queryable → rely on the ledger claim */ }
    if (existing?.Id) {
      await release({ qb_payment_id: String(existing.Id), qb_payment_posted_at: now.toISOString(), qb_post_error: null });
      return "already_in_qb";
    }

    const inv = await deps.qb.getInvoice(conn, String(row.qb_invoice_id));
    if (!inv) {
      await release({ qb_post_error: `QuickBooks invoice ${row.qb_invoice_id} not found` });
      await insertShopNotification(admin, {
        shopOwner: row.shop_owner,
        eventType: "payment_not_booked",
        severity: "alert",
        title: `Payment received but its QuickBooks invoice is gone: $${(row.amount_cents / 100).toFixed(2)}`,
        body: `The invoice this payment was for (QuickBooks #${row.qb_invoice_id}) no longer exists. Record the payment on the right invoice in QuickBooks.`,
        metadata: { processor: SOURCE, payin_id: payinId },
      });
      return "invoice_missing";
    }

    const app = planQbApplication({ amountCents: row.amount_cents, liveBalanceCents: Math.round(Number(inv.Balance) * 100) });
    if (!app.ok) throw new Error(`bad amounts for ${payinId}`);
    const method = pickQbPaymentMethod(await deps.qb.paymentMethods(conn), row.method === "ach" ? "ach" : "card");
    const built = buildQbPaymentBody({
      qbInvoiceId: String(row.qb_invoice_id),
      customerRefValue: inv?.CustomerRef?.value,
      amountCents: row.amount_cents,
      applyCents: app.applyCents,
      payinId,
      txnDate: String(row.last_event_at ?? now.toISOString()).slice(0, 10),
      paymentMethodRef: method,
      platformFeeCents: row.platform_fee_cents ?? 0,
    });
    if (!built.ok) {
      await release({ qb_post_error: `payment body refused: ${built.reason}` });
      opsAlert(`QB payment body refused for ${payinId}: ${built.reason}`);
      return "body_refused";
    }

    const res = await deps.qb.postPayment(conn, built.body);
    const qbPaymentId = String(res?.Payment?.Id ?? res?.Id ?? "");
    if (!qbPaymentId) throw new Error("QuickBooks returned no Payment id");
    // Record it. If this write fails the claim stays set and the next
    // retry finds the payment by its ref number instead of posting again.
    const { error: wErr } = await admin.from("processor_payments")
      .update({ qb_payment_id: qbPaymentId, qb_payment_posted_at: now.toISOString(), qb_posting_at: null, qb_post_error: null })
      .eq("processor_payin_id", payinId);
    if (wErr) opsAlert(`posted QB payment ${qbPaymentId} but ledger write failed`, { payinId, error: wErr.message });

    if (app.overpaid) {
      await insertShopNotification(admin, {
        shopOwner: row.shop_owner,
        eventType: "payment_overpaid",
        severity: "alert",
        title: `Customer overpaid by $${(app.unappliedCents / 100).toFixed(2)}`,
        body: "This invoice was already paid when another payment came in. The extra is sitting as a customer credit in QuickBooks. Refund it to the customer.",
        metadata: { processor: SOURCE, payin_id: payinId, qb_payment_id: qbPaymentId },
      });
    }
    return app.overpaid ? "posted_overpaid" : "posted";
  } catch (err) {
    await release({ qb_post_error: String((err as Error)?.message ?? err).slice(0, 500) });
    throw err;
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return ok({ error: "method not allowed" }, 405);
  const { admin } = deps;
  const rawBody = await req.text();

  const sig = await verifyWebhookSignature({
    secret: deps.env("RAINFOREST_WEBHOOK_SECRET") ?? "",
    rawBody,
    id: req.headers.get("svix-id") ?? req.headers.get("webhook-id"),
    timestamp: req.headers.get("svix-timestamp") ?? req.headers.get("webhook-timestamp"),
    signature: req.headers.get("svix-signature") ?? req.headers.get("webhook-signature"),
    nowSeconds: Math.floor(((deps.now ?? (() => new Date()))()).getTime() / 1000),
  });
  if (!sig.ok) {
    console.error(`[rainforestWebhook] rejected: ${sig.reason}`);
    return ok({ error: "invalid signature" }, 401);
  }

  let body: Any;
  try { body = JSON.parse(rawBody); } catch { return ok({ error: "bad json" }, 400); }

  const route = routeWebhook(body);
  if (route.route === "ignore" || route.route === "deposit") {
    // Payouts are booked by the payout reconciler, not per event.
    return ok({ ok: true, ignored: route.route === "ignore" ? route.reason : "deposit" });
  }

  const key = webhookDedupeKey(body) ?? "";
  const claim = await claimWebhookEventDetailed(admin, SOURCE, key, { event_type: body?.event_type });
  if (claim.status === CLAIM_OUTCOMES.DUPLICATE) return ok({ ok: true, duplicate: true });
  if (claim.status === CLAIM_OUTCOMES.ERROR) return ok({ error: "try again" }, 503);

  try {
    if (route.route === "merchant") {
      if (!route.merchantId) return ok({ ok: true, ignored: "no merchant id" });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (route.merchantStatus) patch.merchant_status = route.merchantStatus;
      if (route.applicationStatus) patch.merchant_application_status = route.applicationStatus;
      if (route.merchantStatus === "active") patch.onboarded_at = new Date().toISOString();
      // Suspended/deactivated/canceled merchants can't take payments: the rail
      // falls back to QuickBooks automatically (resolvePaymentRail).
      const { error } = await admin.from("processor_accounts").update(patch).eq("merchant_id", route.merchantId);
      if (error) throw new Error(`merchant update failed: ${error.message}`);
      return ok();
    }

    let event: Any;
    if (route.route === "fetch_payin") {
      if (!route.payinId) return ok({ ok: true, ignored: "no payin id" });
      const payin = await deps.rainforestGet(`/v1/payins/${encodeURIComponent(route.payinId)}`);
      const kind = route.kind === "refund" ? refundKind(payin) : String(route.kind);
      event = payinToEvent(kind, payin, { reversalCents: route.reversalCents });
    } else {
      event = route.event;
    }

    const { data: account } = await admin.from("processor_accounts")
      .select("shop_owner, merchant_id").eq("merchant_id", event.merchantId).maybeSingle();
    const doc = await loadDoc(admin, event.metadata);
    const { data: ledger } = await admin.from("processor_payments")
      .select("status, method, qb_payment_id").eq("processor_payin_id", event.payinId).maybeSingle();

    const fee = event.method ? platformFeeCents(event.method, event.amountCents) : 0;
    const plan: Any = planPayinEffect({ event, account, quote: doc, ledger, platformFeeCents: fee });

    if (plan.alertOps) opsAlert(plan.alertOps, { payinId: event.payinId, reject: plan.reject });
    if (plan.ledger) {
      const { error } = await admin.from("processor_payments")
        .upsert({ ...plan.ledger, updated_at: new Date().toISOString() }, { onConflict: "processor_payin_id" });
      if (error) throw new Error(`ledger write failed: ${error.message}`);
    }
    if (plan.notify && account?.shop_owner) {
      await insertShopNotification(admin, <Any>{
        shopOwner: account.shop_owner,
        eventType: `payment_${event.kind}`,
        severity: plan.notify.severity,
        title: plan.notify.title,
        body: plan.notify.body,
        relatedEntity: doc ? (event.metadata?.inktracker_doc_type === "invoice" ? "invoice" : "quote") : null,
        relatedId: doc?.id ?? null,
        metadata: plan.notify.metadata,
      });
    }
    let posted: string | null = null;
    if (plan.postQbPayment) posted = await postQbPaymentOnce(deps, event.payinId);
    return ok({ ok: true, kind: event.kind, reject: plan.reject ?? null, posted });
  } catch (err) {
    await releaseWebhookEvent(admin, SOURCE, key);
    opsAlert(`processing failed: ${(err as Error)?.message ?? err}`, { event_type: body?.event_type });
    return ok({ error: "processing failed" }, 500);
  }
}

if (import.meta.main) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiBase = (Deno.env.get("RAINFOREST_API_BASE") ?? "https://api.sandbox.rainforestpay.com").replace(/\/$/, "");
  Deno.serve((req) => handle(req, {
    admin,
    env: (k) => Deno.env.get(k),
    rainforestGet: async (path) => {
      const res = await fetch(`${apiBase}${path}`, {
        headers: {
          Authorization: `Bearer ${Deno.env.get("RAINFOREST_API_KEY") ?? ""}`,
          "Rainforest-Api-Version": "2024-10-16",
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`Rainforest GET ${path} → ${res.status}`);
      const j = await res.json();
      return j?.data ?? j;
    },
    qb: {
      connect: (shop) => getShopQb(admin, shop),
      getInvoice: qbGetInvoice,
      paymentMethods: qbListPaymentMethods,
      findPaymentByRef: qbFindPaymentByRef,
      postPayment: (c, b) => qbPost(c, "payment", b),
    },
  }));
}
