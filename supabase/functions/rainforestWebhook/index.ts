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
// Payouts: deposit.succeeded → one QuickBooks Deposit (clean payouts only;
// anything with refunds/returns/chargebacks → the shop records it, told once).
//
// Nightly sweep (POST with `Authorization: Bearer CRON_SECRET`, from the
// qb-reconcile GitHub workflow): retries payments and payouts that couldn't
// be booked at the time (QuickBooks disconnected/down past Rainforest's ≈28h
// of retries, or a payout that arrived before its payments were booked).
//
// Secrets: RAINFOREST_WEBHOOK_SECRET (whsec_… from the Portal endpoint),
// RAINFOREST_API_KEY, RAINFOREST_API_BASE (sandbox/prod), CRON_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  verifyWebhookSignature,
  routeWebhook,
  webhookDedupeKey,
  payinToEvent,
  refundKind,
} from "../_shared/rainforestWebhookAdapter.js";
import { planPayinEffect, planQbApplication, statusesBelow } from "../_shared/rainforestPayinEffect.js";
import { platformFeeCents } from "../_shared/rainforestPricing.js";
import { buildQbPaymentBody, pickQbPaymentMethod, findBookedPayment } from "../_shared/rainforestQbBooks.js";
import {
  claimWebhookEventDetailed,
  releaseWebhookEvent,
  CLAIM_OUTCOMES,
} from "../_shared/webhookIdempotency.js";
import { insertShopNotification } from "../_shared/notifications.js";
import { captureError } from "../_shared/observability.ts";
import { planPayoutDeposit, PAYOUT_PLAN } from "../_shared/rainforestPayout.js";
import { shopTimezone, localDate } from "../_shared/shopDate.js";
import {
  getShopQb,
  qbGetInvoice,
  qbListPaymentMethods,
  qbRecentCustomerPayments,
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
    recentCustomerPayments: (c: QbConn, customerRef: string) => Promise<Any[]>;
    postPayment: (c: QbConn, body: unknown) => Promise<Any>;
    postDeposit: (c: QbConn, body: unknown) => Promise<Any>;
  };
  now?: () => Date;
};

const ok = (body: unknown = { ok: true }, status = 200) => Response.json(body, { status });

// deno-lint-ignore no-explicit-any
function opsAlert(message: string, context: Record<string, unknown> = {}) {
  console.error(`[rainforestWebhook] ${message}`, context);
  captureError(new Error(message), { fn: "rainforestWebhook", ...context }).catch(() => {});
}

/** The shop's timezone, for QuickBooks transaction dates. */
async function loadShopTz(admin: Any, shopOwner: string): Promise<string> {
  const [{ data: shop }, { data: profile }] = await Promise.all([
    admin.from("shops").select("timezone").eq("owner_email", shopOwner).maybeSingle(),
    admin.from("profiles").select("state").eq("email", shopOwner).maybeSingle(),
  ]);
  return shopTimezone({ timezone: shop?.timezone, state: profile?.state });
}

async function loadDoc(admin: Any, md: Any) {
  const id = String(md?.inktracker_quote_id ?? "");
  if (!UUID_RE.test(id)) return null;
  if (md?.inktracker_doc_type === "invoice") {
    const { data } = await admin.from("invoices").select("id, invoice_id, shop_owner, qb_invoice_id, qb_deposit_invoice_id").eq("id", id).maybeSingle();
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
    .select("processor_payin_id, shop_owner, qb_invoice_id, amount_cents, platform_fee_cents, method, pay_kind, last_event_at, paid_at, quote_id, invoice_id, qb_post_notified_at");
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

  // Tell the shop about a booking problem ONCE per payment (the nightly
  // sweep retries silently after that).
  const notifyOnce = async (n: Any) => {
    if (row.qb_post_notified_at) return;
    await insertShopNotification(admin, n);
    await admin.from("processor_payments").update({ qb_post_notified_at: now.toISOString() }).eq("processor_payin_id", payinId);
  };

  try {
    const conn = await deps.qb.connect(row.shop_owner);
    if (!conn) {
      await release({ qb_post_error: "QuickBooks not connected" });
      await notifyOnce({
        shopOwner: row.shop_owner,
        eventType: "payment_not_booked",
        severity: "alert",
        title: `Payment received but not recorded in QuickBooks: $${(row.amount_cents / 100).toFixed(2)}`,
        body: `QuickBooks isn't connected, so this online payment couldn't be recorded on invoice #${row.qb_invoice_id} yet. Reconnect QuickBooks in Account settings and InkTracker will record it overnight.`,
        metadata: { processor: SOURCE, payin_id: payinId },
      });
      return "no_qb_connection";
    }

    const inv = await deps.qb.getInvoice(conn, String(row.qb_invoice_id));
    if (!inv) {
      await release({ qb_post_error: `QuickBooks invoice ${row.qb_invoice_id} not found` });
      await notifyOnce({
        shopOwner: row.shop_owner,
        eventType: "payment_not_booked",
        severity: "alert",
        title: `Payment received but its QuickBooks invoice is gone: $${(row.amount_cents / 100).toFixed(2)}`,
        body: `The invoice this payment was for (QuickBooks #${row.qb_invoice_id}) no longer exists. Record the payment on the right invoice in QuickBooks.`,
        metadata: { processor: SOURCE, payin_id: payinId },
      });
      return "invoice_missing";
    }

    // Already in QuickBooks (e.g. a crash after posting, before our write)?
    // This lookup is the guard against posting twice after a crash or a
    // timed-out POST that actually landed. If it can't run, don't post —
    // throw so the event (or the sweep) retries later.
    const existing: Any = findBookedPayment(await deps.qb.recentCustomerPayments(conn, String(inv?.CustomerRef?.value ?? "")), payinId);
    if (existing?.Id) {
      await release({ qb_payment_id: String(existing.Id), qb_payment_posted_at: now.toISOString(), qb_post_error: null });
      return "already_in_qb";
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
      // The shop's calendar date — a 6pm payment isn't "tomorrow" in its books.
      txnDate: localDate(row.paid_at ?? row.last_event_at ?? now.toISOString(), await loadShopTz(admin, row.shop_owner)),
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

/** Book one Rainforest payout into QuickBooks, exactly once. */
export async function processPayout(deps: Deps, depositId: string): Promise<string> {
  const { admin } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const deposit = await deps.rainforestGet(`/v1/deposits/${encodeURIComponent(depositId)}`);
  if (!deposit?.merchant_id) return "no_deposit";
  const { data: account } = await admin.from("processor_accounts")
    .select("shop_owner, merchant_id, qb_bank_account_id, qb_fee_account_id")
    .eq("merchant_id", deposit.merchant_id).maybeSingle();
  if (!account) { opsAlert(`payout ${depositId} for merchant ${deposit.merchant_id} that no shop owns`); return "unknown_merchant"; }

  const tz = await loadShopTz(admin, account.shop_owner);
  const payoutDate = localDate(deposit.created_at ?? now.toISOString(), tz);
  const { data: existing } = await admin.from("processor_payouts")
    .select("qb_deposit_id, review_notified_at").eq("processor_payout_id", depositId).maybeSingle();
  if (existing?.qb_deposit_id) return "already_booked";
  if (!existing) {
    const { error } = await admin.from("processor_payouts").upsert({
      processor_payout_id: depositId,
      shop_owner: account.shop_owner,
      merchant_id: deposit.merchant_id,
      net_cents: Number(deposit.amount) || 0,
      payout_date: payoutDate,
      status: String(deposit.status ?? "").toLowerCase(),
    }, { onConflict: "processor_payout_id" });
    if (error) throw new Error(`payout row write failed: ${error.message}`);
  }

  // All activity, paged.
  const activities: Any[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await deps.rainforestGet(`/v1/deposits/${encodeURIComponent(depositId)}/activity?limit=100&offset=${offset}`);
    const rows = page?.activities ?? [];
    activities.push(...rows);
    if (rows.length < 100) break;
  }
  const payinIds = activities.filter((a) => String(a?.type).toUpperCase() === "PAYIN").map((a) => String(a.id ?? a.payin_id));
  const ledgerByPayin = new Map<string, Any>();
  if (payinIds.length) {
    const { data: rows } = await admin.from("processor_payments")
      .select("processor_payin_id, qb_payment_id, amount_cents")
      .eq("shop_owner", account.shop_owner)
      .in("processor_payin_id", payinIds);
    for (const r of rows ?? []) ledgerByPayin.set(String(r.processor_payin_id), r);
  }

  const plan: Any = planPayoutDeposit({ deposit, activities, ledgerByPayin, account, txnDate: payoutDate });
  if (plan.plan === PAYOUT_PLAN.SKIP) return `skip:${plan.reason}`;
  if (plan.plan === PAYOUT_PLAN.WAIT) {
    await admin.from("processor_payouts").update({ qb_post_error: "waiting: payments not yet in QuickBooks", updated_at: now.toISOString() }).eq("processor_payout_id", depositId);
    return "wait";
  }
  if (plan.plan === PAYOUT_PLAN.MANUAL) {
    await admin.from("processor_payouts").update({
      qb_post_error: `needs_review: ${plan.problems.join(" ")}`.slice(0, 1000),
      review_notified_at: existing?.review_notified_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    }).eq("processor_payout_id", depositId);
    if (!existing?.review_notified_at) {
      await insertShopNotification(admin, <Any>{
        shopOwner: account.shop_owner,
        eventType: "payout_needs_review",
        severity: plan.notify.severity,
        title: plan.notify.title,
        body: plan.notify.body,
        metadata: plan.notify.metadata,
      });
    }
    return "manual";
  }

  // POST — claim first so two workers can't both create the Deposit. Unlike
  // payments there is no reliable way to look a Deposit up afterwards, so a
  // claim is NEVER retaken automatically: a payout stuck mid-post is flagged
  // for a person (sweep) instead of risking a second Deposit.
  const { data: claimed, error: claimErr } = await admin.from("processor_payouts")
    .update({ qb_posting_at: now.toISOString() })
    .eq("processor_payout_id", depositId)
    .is("qb_deposit_id", null)
    .is("qb_posting_at", null)
    .select("processor_payout_id");
  if (claimErr) throw new Error(`payout claim failed: ${claimErr.message}`);
  if (!claimed?.length) return "not_claimed";

  let qbDepositId = "";
  try {
    const conn = await deps.qb.connect(account.shop_owner);
    if (!conn) {
      await admin.from("processor_payouts").update({ qb_posting_at: null, qb_post_error: "QuickBooks not connected" }).eq("processor_payout_id", depositId);
      return "no_qb_connection";
    }
    const res = await deps.qb.postDeposit(conn, plan.body);
    qbDepositId = String(res?.Deposit?.Id ?? res?.Id ?? "");
    if (!qbDepositId) throw new Error("QuickBooks returned no Deposit id");
  } catch (err) {
    // Not posted (or QuickBooks said no): safe to release for a retry. A
    // timeout here is the one ambiguous case — release anyway would risk a
    // double; keep the claim and flag it.
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    const ambiguous = /timed? ?out|network|ECONNRESET|fetch failed/i.test(msg);
    try {
      await admin.from("processor_payouts").update(ambiguous
        ? { qb_post_error: `check_quickbooks: ${msg}` }
        : { qb_posting_at: null, qb_post_error: msg }).eq("processor_payout_id", depositId);
    } catch { /* surfaced below */ }
    throw err;
  }

  // Posted. Record it — retried, and NEVER released on failure (a released
  // claim could post the Deposit twice).
  const patch = {
    qb_deposit_id: qbDepositId,
    qb_deposit_posted_at: now.toISOString(),
    qb_posting_at: null,
    qb_post_error: null,
    fee_cents: plan.feeCents,
    net_cents: plan.netCents,
    status: "succeeded",
    updated_at: now.toISOString(),
  };
  let recorded = false;
  for (let i = 0; i < 3 && !recorded; i++) {
    try {
      const { error } = await admin.from("processor_payouts").update(patch).eq("processor_payout_id", depositId);
      recorded = !error;
    } catch { /* retry */ }
  }
  if (!recorded) {
    opsAlert(`payout ${depositId} POSTED as QuickBooks deposit ${qbDepositId} but not recorded — set processor_payouts.qb_deposit_id by hand`, { depositId, qbDepositId });
    return "booked_unrecorded";
  }
  await admin.from("processor_payments").update({ processor_payout_id: depositId })
    .eq("shop_owner", account.shop_owner).in("processor_payin_id", plan.payinIds);
  return "booked";
}

/** Nightly: retry what couldn't be booked at the time. */
export async function sweep(deps: Deps): Promise<Record<string, number>> {
  const { admin } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const olderThan = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const out = { payments: 0, paymentsBooked: 0, payouts: 0, payoutsBooked: 0, errors: 0 };

  const { data: pending } = await admin.from("processor_payments")
    .select("processor_payin_id, status, method")
    .is("qb_payment_id", null)
    .not("qb_invoice_id", "is", null)
    .in("status", ["succeeded", "processing"])
    .lt("updated_at", olderThan)
    .order("updated_at", { ascending: true })
    .limit(100);
  for (const r of pending ?? []) {
    if (r.status === "processing" && r.method !== "card") continue; // bank not cleared yet
    out.payments++;
    try {
      if ((await postQbPaymentOnce(deps, String(r.processor_payin_id))).startsWith("posted")) out.paymentsBooked++;
    } catch (err) {
      out.errors++;
      opsAlert(`sweep: payment ${r.processor_payin_id} still not booked: ${(err as Error)?.message ?? err}`);
    }
  }

  // Payouts still to book: not sent to the shop for review, not mid-post.
  const { data: payouts } = await admin.from("processor_payouts")
    .select("processor_payout_id, qb_post_error")
    .is("qb_deposit_id", null)
    .is("review_notified_at", null)
    .is("qb_posting_at", null)
    .order("created_at", { ascending: true })
    .limit(100);
  // Payouts whose post was interrupted: never retried automatically.
  const { data: stuck } = await admin.from("processor_payouts")
    .select("processor_payout_id, qb_posting_at, qb_post_error")
    .is("qb_deposit_id", null)
    .not("qb_posting_at", "is", null)
    .lt("qb_posting_at", new Date(now.getTime() - STALE_POST_CLAIM_MS).toISOString())
    .limit(50);
  for (const p of stuck ?? []) {
    opsAlert(`payout ${p.processor_payout_id} stuck mid-post since ${p.qb_posting_at}: check QuickBooks for a deposit, then set qb_deposit_id or clear qb_posting_at`, { error: p.qb_post_error });
  }
  for (const p of payouts ?? []) {
    out.payouts++;
    try {
      if ((await processPayout(deps, String(p.processor_payout_id))) === "booked") out.payoutsBooked++;
    } catch (err) {
      out.errors++;
      opsAlert(`sweep: payout ${p.processor_payout_id} still not booked: ${(err as Error)?.message ?? err}`);
    }
  }
  return out;
}

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return ok({ error: "method not allowed" }, 405);
  const { admin } = deps;

  // Nightly sweep — authenticated by CRON_SECRET, not a webhook signature.
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer && !req.headers.get("svix-signature") && !req.headers.get("webhook-signature")) {
    if (!sameSecret(bearer, deps.env("CRON_SECRET") ?? "")) return ok({ error: "unauthorized" }, 401);
    try {
      return ok({ ok: true, sweep: await sweep(deps) });
    } catch (err) {
      opsAlert(`sweep failed: ${(err as Error)?.message ?? err}`);
      return ok({ error: "sweep failed" }, 500);
    }
  }

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
  if (route.route === "ignore") return ok({ ok: true, ignored: route.reason });
  if (route.route === "deposit" && (route.status !== "succeeded" || !route.depositId)) {
    return ok({ ok: true, ignored: `deposit.${route.status}` });
  }

  // One Svix message id per event (stable across Rainforest's retries), so a
  // merchant that goes active → suspended → active → suspended isn't
  // mistaken for a duplicate. Resource key only as a fallback.
  const msgId = req.headers.get("svix-id") ?? req.headers.get("webhook-id");
  const key = (msgId ? `msg:${msgId}` : webhookDedupeKey(body)) ?? "";
  const claim = await claimWebhookEventDetailed(admin, SOURCE, key, { event_type: body?.event_type });
  if (claim.status === CLAIM_OUTCOMES.DUPLICATE) return ok({ ok: true, duplicate: true });
  if (claim.status === CLAIM_OUTCOMES.ERROR) return ok({ error: "try again" }, 503);

  try {
    if (route.route === "deposit") {
      return ok({ ok: true, payout: await processPayout(deps, String(route.depositId)) });
    }

    if (route.route === "merchant") {
      if (!route.merchantId) return ok({ ok: true, ignored: "no merchant id" });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (route.merchantStatus) patch.merchant_status = route.merchantStatus;
      if (route.applicationStatus) patch.merchant_application_status = route.applicationStatus;
      if (route.merchantStatus === "active") patch.onboarded_at = new Date().toISOString();
      // Suspended/deactivated/canceled merchants can't take payments: the rail
      // falls back to QuickBooks automatically (resolvePaymentRail).
      const { data: before } = await admin.from("processor_accounts")
        .select("shop_owner, merchant_status, enabled").eq("merchant_id", route.merchantId).maybeSingle();
      const { error } = await admin.from("processor_accounts").update(patch).eq("merchant_id", route.merchantId);
      if (error) throw new Error(`merchant update failed: ${error.message}`);
      // A switched-on shop just lost the ability to take payments here.
      const lost = ["suspended", "deactivated", "canceled"].includes(String(route.merchantStatus ?? ""));
      if (lost && before?.enabled && before.merchant_status === "active") {
        await insertShopNotification(admin, <Any>{
          shopOwner: before.shop_owner,
          eventType: "payments_account_on_hold",
          severity: "alert",
          title: route.merchantStatus === "suspended" ? "Your payments account is on hold" : "Your payments account was closed",
          body: "Customers pay through QuickBooks again. Quotes and invoices you already sent with an InkTracker pay link can't be paid online until you re-send them from InkTracker, which adds a QuickBooks pay link. Check your email from Rainforest for details.",
          metadata: { processor: SOURCE, merchant_status: route.merchantStatus },
        });
      }
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
      .select("status, method, qb_payment_id, quote_id, invoice_id, qb_invoice_id").eq("processor_payin_id", event.payinId).maybeSingle();

    const fee = event.method ? platformFeeCents(event.method, event.amountCents) : 0;
    const plan: Any = planPayinEffect({ event, account, quote: doc, ledger, platformFeeCents: fee });

    if (plan.alertOps) opsAlert(plan.alertOps, { payinId: event.payinId, reject: plan.reject });
    if (plan.ledger) {
      const row = { ...plan.ledger, updated_at: new Date().toISOString() };
      // Forward-only, atomically: a guarded update never moves a status
      // backwards even when two events race (card processing + succeeded).
      const guardedUpdate = async () => {
        const { quote_id: _q, invoice_id: _i, qb_invoice_id: _b, pay_kind: _k, ...keepLinks } = row as Any;
        const { error } = await admin.from("processor_payments").update(keepLinks)
          .eq("processor_payin_id", event.payinId)
          .in("status", statusesBelow(event.kind));
        if (error) throw new Error(`ledger write failed: ${error.message}`);
      };
      if (!ledger) {
        const { error } = await admin.from("processor_payments").insert(row);
        if (error?.code === "23505") await guardedUpdate(); // a racing event created it
        else if (error) throw new Error(`ledger write failed: ${error.message}`);
      } else {
        await guardedUpdate();
      }
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
      recentCustomerPayments: qbRecentCustomerPayments,
      postPayment: (c, b) => qbPost(c, "payment", b),
      postDeposit: (c, b) => qbPost(c, "deposit", b),
    },
  }));
}
