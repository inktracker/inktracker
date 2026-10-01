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
  kindForPayinStatus,
  readListPage,
} from "../_shared/rainforestWebhookAdapter.js";
import { planPayinEffect, planQbApplication, statusesBelow, statusAdvances, BOOKABLE_STATUSES, PAYIN_EVENT } from "../_shared/rainforestPayinEffect.js";
import { platformFeeCents } from "../_shared/rainforestPricing.js";
import { buildQbPaymentBody, pickQbPaymentMethod, findBookedPayment } from "../_shared/rainforestQbBooks.js";
import {
  claimWebhookEventDetailed,
  releaseWebhookEvent,
  CLAIM_OUTCOMES,
} from "../_shared/webhookIdempotency.js";
import { insertShopNotification } from "../_shared/notifications.js";
import { sendResendEmail } from "../_shared/resendClient.js";
import { escapeHtml } from "../_shared/emailSanitize.js";
import { renderEmailLayout } from "../_shared/emailLayout.ts";
import { captureError } from "../_shared/observability.ts";
import { planPayoutDeposit, PAYOUT_PLAN } from "../_shared/rainforestPayout.js";
import { shopTimezone, localDate } from "../_shared/shopDate.js";
import { merchantStatusFields } from "../_shared/rainforestAccount.js";
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
  /** Email sender (Resend by default); injectable for tests. */
  sendEmail?: (payload: Any) => Promise<Any>;
};

const ok = (body: unknown = { ok: true }, status = 200) => Response.json(body, { status });

/**
 * Tell the shop. Every notice goes to the in-app bell (and push, if they
 * turned it on). ALERTS — a dispute with an evidence deadline, a bounced
 * bank payment, money not recorded in QuickBooks — are also emailed to the
 * owner, so they don't sit unseen in the bell. Email failure never blocks
 * the webhook.
 */
async function notifyShop(deps: Deps, n: Any) {
  await insertShopNotification(deps.admin, n);
  if (n?.severity !== "alert" || !n?.shopOwner) return;
  try {
    const html = renderEmailLayout({
      shopName: "InkTracker",
      subhead: "Payments",
      contentHtml: `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(n.title)}</p><p style="margin:0 0 16px;line-height:1.5">${escapeHtml(n.body ?? "")}</p><p style="margin:0"><a href="https://www.inktracker.app/Dashboard">Open InkTracker</a></p>`,
    });
    const send = deps.sendEmail ?? ((payload: Any) => sendResendEmail(payload));
    const r = await send({
      from: `InkTracker <${deps.env("FROM_EMAIL") ?? "quotes@info.inktracker.app"}>`,
      to: [n.shopOwner],
      subject: n.title,
      html,
      text: `${n.title}\n\n${n.body ?? ""}`,
    });
    if (r && r.ok === false) console.error(`[rainforestWebhook] alert email not sent: ${r.reason ?? r.status}`);
  } catch (err) {
    console.error(`[rainforestWebhook] alert email threw: ${err}`);
  }
}

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
      const { error } = await admin.from("processor_payments")
        .update({ qb_posting_at: null, updated_at: new Date().toISOString(), ...patch })
        .eq("processor_payin_id", payinId);
      if (error) opsAlert(`ledger release failed for ${payinId}`, { error: error.message });
    } catch (e) {
      opsAlert(`ledger release threw for ${payinId}`, { error: String(e) });
    }
  };

  // Tell the shop about a booking problem ONCE per payment (the nightly
  // sweep retries silently after that).
  const notifyOnce = async (n: Any) => {
    if (row.qb_post_notified_at) return;
    await notifyShop(deps, n);
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
      await notifyShop(deps, {
        shopOwner: row.shop_owner,
        eventType: "payment_overpaid",
        severity: "alert",
        title: `Customer overpaid by $${(app.unappliedCents / 100).toFixed(2)}`,
        body: "This invoice was already paid when another payment came in. The extra is sitting as a customer credit in QuickBooks. Refund it to the customer from Account → Payments → Payments & payouts (open the payment, then Refund).",
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
  // Chunked (long payouts would overflow the URL); a read error must retry,
  // never read as "not our payments".
  for (let i = 0; i < payinIds.length; i += 100) {
    const { data: rows, error } = await admin.from("processor_payments")
      .select("processor_payin_id, qb_payment_id, qb_invoice_id, amount_cents")
      .eq("shop_owner", account.shop_owner)
      .in("processor_payin_id", payinIds.slice(i, i + 100));
    if (error) throw new Error(`ledger read failed: ${error.message}`);
    for (const r of rows ?? []) ledgerByPayin.set(String(r.processor_payin_id), r);
  }

  const plan: Any = planPayoutDeposit({ deposit, activities, ledgerByPayin, account, txnDate: payoutDate, now });
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
      await notifyShop(deps, <Any>{
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
    // Release the claim ONLY when QuickBooks definitely refused (400 = a
    // validation Fault, 401/403 = never reached the books). Everything else —
    // 5xx, gateway timeouts, a dropped connection, an unreadable response —
    // may have created the Deposit, and a retry would double-count the bank.
    // Keep the claim and flag it for a person (the sweep reports it daily).
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    const status = Number((err as Any)?.status);
    const definitelyRejected = [400, 401, 403].includes(status);
    try {
      await admin.from("processor_payouts").update(definitelyRejected
        ? { qb_posting_at: null, qb_post_error: msg, updated_at: now.toISOString() }
        : { qb_post_error: `check_quickbooks: ${msg}` }).eq("processor_payout_id", depositId);
    } catch { /* surfaced below */ }
    if (!definitelyRejected) {
      opsAlert(`payout ${depositId}: QuickBooks Deposit may have been created (${msg}) — check QuickBooks before retrying`, { depositId });
      return "check_quickbooks";
    }
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

/**
 * Bring our copy of a merchant's status up to date. The webhook body is a
 * snapshot from when the event fired, and Rainforest retries for ~28h with
 * no ordering guarantee — a retried old "active" landing after "suspended"
 * would put a suspended shop back on InkTracker payments. So the event is
 * only a trigger: read the merchant's CURRENT state and store that. Also
 * used by the nightly sweep. Tells the owner about changes that matter.
 */
export async function syncMerchant(deps: Deps, merchantId: string): Promise<string> {
  const { admin } = deps;
  const { data: before } = await admin.from("processor_accounts")
    .select("shop_owner, merchant_status, merchant_application_status, enabled, onboarded_at")
    .eq("merchant_id", merchantId).maybeSingle();
  if (!before) return "unknown_merchant";
  const current = await deps.rainforestGet(`/v1/merchants/${encodeURIComponent(merchantId)}`);
  const fields = merchantStatusFields(current);
  if (!fields.merchant_status && !fields.merchant_application_status) return "no_status";
  const now = new Date().toISOString();
  const becameActive = fields.merchant_status === "active" && before.merchant_status !== "active";
  const { error } = await admin.from("processor_accounts").update({
    ...fields,
    ...(becameActive && !before.onboarded_at ? { onboarded_at: now } : {}),
    updated_at: now,
  }).eq("merchant_id", merchantId);
  if (error) throw new Error(`merchant update failed: ${error.message}`);

  const ms = fields.merchant_status ?? before.merchant_status;
  const app = fields.merchant_application_status ?? before.merchant_application_status;
  const lost = ["suspended", "deactivated", "canceled"].includes(String(ms)) && before.merchant_status === "active";
  if (lost && before.enabled) {
    // A switched-on shop just lost the ability to take payments here.
    await notifyShop(deps, <Any>{
      shopOwner: before.shop_owner,
      eventType: "payments_account_on_hold",
      severity: "alert",
      title: ms === "suspended" ? "Your payments account is on hold" : "Your payments account was closed",
      body: "Customers pay through QuickBooks again. Quotes and invoices you already sent with an InkTracker pay link can't be paid online until you re-send them from InkTracker, which adds a QuickBooks pay link. Check your email from Rainforest for details.",
      metadata: { processor: SOURCE, merchant_status: ms },
    });
  } else if (app === "needs_information" && before.merchant_application_status !== "needs_information") {
    // Unanswered, the application is auto-canceled after 120 days.
    await notifyShop(deps, <Any>{
      shopOwner: before.shop_owner,
      eventType: "payments_needs_information",
      severity: "alert",
      title: "Your payments sign-up needs more information",
      body: "Rainforest needs a bit more information to approve your payments account. Open Account → Payments and click Continue sign-up.",
      metadata: { processor: SOURCE },
    });
  } else if (becameActive) {
    await notifyShop(deps, <Any>{
      shopOwner: before.shop_owner,
      eventType: "payments_approved",
      severity: "info",
      title: "Your payments account is approved",
      body: before.enabled
        ? "Customers can pay on InkTracker again."
        : "Next: open Account → Payments, choose your QuickBooks accounts, and turn InkTracker payments on.",
      metadata: { processor: SOURCE },
    });
  }
  return "synced";
}

/**
 * Apply one neutral payment event: ledger (forward-only), shop notice, QB
 * booking. Shared by the webhook and the nightly Rainforest backstop, so a
 * payment is handled identically however we learn about it. Idempotent.
 */
export async function applyPayinEvent(deps: Deps, event: Any): Promise<{ kind: string; reject: string | null; posted: string | null }> {
  const { admin } = deps;
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
    await notifyShop(deps, <Any>{
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
  return { kind: event.kind, reject: plan.reject ?? null, posted };
}

/**
 * Backstop against Rainforest itself. The webhook claims an event before
 * processing it; if the function is killed mid-way (timeout, deploy) the
 * claim stays and Rainforest's retries are dropped as duplicates, so a
 * payment could exist at Rainforest with no ledger row — never recorded,
 * never booked. Each night, list the last few days of payins and replay any
 * we're missing or behind on through the same code path. Idempotent.
 */
export async function reconcileRecentPayins(deps: Deps, sinceIso: string): Promise<{ checked: number; replayed: number }> {
  const { admin } = deps;
  const { data: accounts } = await admin.from("processor_accounts").select("merchant_id").not("merchant_id", "is", null);
  const ours = new Set((accounts ?? []).map((a: Any) => String(a.merchant_id)));
  const out = { checked: 0, replayed: 0 };
  if (!ours.size) return out;
  let key: string | null = null;
  for (let page = 0; page < 20; page++) {
    const qs = `created_at.start=${encodeURIComponent(sinceIso)}&limit=200&sort_by=created_at&sort_order=asc${key ? `&start_key=${encodeURIComponent(key)}` : ""}`;
    const { items, nextKey } = readListPage(await deps.rainforestGet(`/v1/payins?${qs}`));
    for (const p of items) {
      if (!ours.has(String(p?.merchant_id ?? ""))) continue;
      const kind = kindForPayinStatus(p?.status);
      if (!kind || !p?.payin_id) continue;
      out.checked++;
      const { data: row } = await admin.from("processor_payments").select("status").eq("processor_payin_id", String(p.payin_id)).maybeSingle();
      if (row && !statusAdvances(row.status, kind)) continue;
      await applyPayinEvent(deps, payinToEvent(kind, p));
      out.replayed++;
      if (!row) opsAlert(`backstop recorded payin ${p.payin_id} that the webhook never did`, { kind });
    }
    if (!nextKey || items.length === 0) break;
    key = nextKey;
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reversals Rainforest has that our ledger hasn't caught up with (a lost
 * chargeback / ACH-return event). Applied only when the ledger is BEHIND, so
 * the shop is told once — not every night.
 */
async function reconcileRecentReversals(deps: Deps): Promise<number> {
  const { admin } = deps;
  const { items } = readListPage(await deps.rainforestGet(`/v1/payments?payment_type=CHARGEBACK&payment_type=ACH_RETURN&sort_by=created_at&sort_order=desc&limit=200`));
  let replayed = 0;
  for (const it of items) {
    const payinId = String(it?.payin_id ?? it?.parent_id ?? "");
    if (!payinId) continue;
    const type = String(it?.type ?? it?.payment_type ?? "").toUpperCase();
    const st = String(it?.status ?? "").toUpperCase();
    const kind = type === "ACH_RETURN" ? PAYIN_EVENT.RETURNED
      : st === "LOST" ? PAYIN_EVENT.CHARGED_BACK
      : ["DISPUTE_ACTION_REQUIRED", "INQUIRY_ACTION_REQUIRED", "CHARGEBACK_PROCESSING"].includes(st) ? PAYIN_EVENT.DISPUTED
      : null;
    if (!kind) continue;
    const { data: row } = await admin.from("processor_payments").select("status").eq("processor_payin_id", payinId).maybeSingle();
    if (!row || !statusAdvances(row.status, kind)) continue; // not ours, or already known
    const payin = await deps.rainforestGet(`/v1/payins/${encodeURIComponent(payinId)}`);
    const amt = Number(it?.amount?.amount ?? it?.amount);
    await applyPayinEvent(deps, payinToEvent(kind, payin, { reversalCents: Number.isInteger(amt) ? Math.abs(amt) : undefined }));
    replayed++;
  }
  return replayed;
}

/** Payouts Rainforest made that we have no row for (a lost deposit event). */
async function reconcileRecentDeposits(deps: Deps, sinceIso: string): Promise<number> {
  const { admin } = deps;
  const { data: accounts } = await admin.from("processor_accounts").select("merchant_id").not("merchant_id", "is", null);
  const ours = new Set((accounts ?? []).map((a: Any) => String(a.merchant_id)));
  if (!ours.size) return 0;
  const { items } = readListPage(await deps.rainforestGet(`/v1/deposits?created_at.start=${encodeURIComponent(sinceIso)}&status=SUCCEEDED&limit=1000`));
  let found = 0;
  for (const d of items) {
    if (!ours.has(String(d?.merchant_id ?? "")) || !d?.deposit_id) continue;
    const { data: row } = await admin.from("processor_payouts").select("processor_payout_id").eq("processor_payout_id", String(d.deposit_id)).maybeSingle();
    if (row) continue;
    await processPayout(deps, String(d.deposit_id));
    found++;
  }
  return found;
}

/**
 * A payout the shop's bank returned (wrong account, closed account). If it
 * was already booked in QuickBooks, that Deposit is now money that never
 * arrived — tell the shop exactly which one to void. Rainforest re-sends the
 * funds once the bank details are fixed.
 */
export async function payoutFailed(deps: Deps, depositId: string): Promise<string> {
  const { admin } = deps;
  const deposit = await deps.rainforestGet(`/v1/deposits/${encodeURIComponent(depositId)}`);
  const { data: account } = await admin.from("processor_accounts").select("shop_owner").eq("merchant_id", String(deposit?.merchant_id ?? "")).maybeSingle();
  if (!account) return "unknown_merchant";
  const { data: row } = await admin.from("processor_payouts").select("qb_deposit_id").eq("processor_payout_id", depositId).maybeSingle();
  if (row) {
    await admin.from("processor_payouts").update({ status: "failed", updated_at: new Date().toISOString() }).eq("processor_payout_id", depositId);
  }
  const amt = Number(deposit?.amount);
  const money = Number.isInteger(amt) ? `$${(amt / 100).toFixed(2)}` : "A payout";
  await notifyShop(deps, <Any>{
    shopOwner: account.shop_owner,
    eventType: "payout_failed",
    severity: "alert",
    title: `${money} payout to your bank was returned`,
    body: (row?.qb_deposit_id
      ? `InkTracker had recorded it in QuickBooks as deposit #${row.qb_deposit_id}, but the money didn't arrive. Delete or void that deposit in QuickBooks. `
      : "It wasn't recorded in QuickBooks, so there's nothing to change there. ") +
      "Check the bank account in your payments settings; Rainforest sends the money again once it's fixed.",
    metadata: { processor: SOURCE, deposit_id: depositId, failure: deposit?.failure_code ?? null },
  });
  opsAlert(`payout ${depositId} failed (${deposit?.failure_code ?? "?"})`, { shop: account.shop_owner });
  return "failed_notified";
}

/** Nightly: recover anything missed, then retry what couldn't be booked. */
export async function sweep(deps: Deps): Promise<Record<string, number>> {
  const { admin } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const olderThan = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const out = { payments: 0, paymentsBooked: 0, payouts: 0, payoutsBooked: 0, errors: 0, backstopChecked: 0, backstopReplayed: 0 };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) {
      out.errors++;
      opsAlert(`sweep: ${name} failed: ${(err as Error)?.message ?? err}`);
    }
  };

  // 0. Merchant status, in case a merchant event was lost.
  await step("merchant sync", async () => {
    const { data: accts } = await admin.from("processor_accounts")
      .select("merchant_id, merchant_status").not("merchant_id", "is", null).limit(500);
    for (const a of accts ?? []) {
      if (["canceled", "deactivated"].includes(String(a.merchant_status))) continue;
      await syncMerchant(deps, String(a.merchant_id));
    }
  });

  // 1. Payins Rainforest has that we don't. 10 days: a bank payment's
  //    clearing (T+4 business days) plus a weekend and slack.
  await step("payin backstop", async () => {
    const r = await reconcileRecentPayins(deps, new Date(now.getTime() - 10 * DAY_MS).toISOString());
    out.backstopChecked = r.checked;
    out.backstopReplayed = r.replayed;
  });

  // 1b. Bank payments still "processing" after 4+ days: ask Rainforest for
  //     the payin directly (its "succeeded" event may have been lost, and it
  //     can fall outside any list window).
  await step("stuck bank payments", async () => {
    const { data: stale } = await admin.from("processor_payments")
      .select("processor_payin_id")
      .eq("status", "processing")
      .eq("method", "ach")
      .lt("created_at", new Date(now.getTime() - 4 * DAY_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(100);
    for (const r of stale ?? []) {
      const payin = await deps.rainforestGet(`/v1/payins/${encodeURIComponent(String(r.processor_payin_id))}`);
      const kind = kindForPayinStatus(payin?.status);
      if (kind && kind !== PAYIN_EVENT.PROCESSING) {
        await applyPayinEvent(deps, payinToEvent(kind, payin));
        out.backstopReplayed++;
      }
    }
  });

  // 1c. Lost chargeback / return events, and lost payouts.
  await step("reversal backstop", async () => { out.backstopReplayed += await reconcileRecentReversals(deps); });
  await step("payout backstop", async () => { await reconcileRecentDeposits(deps, new Date(now.getTime() - 10 * DAY_MS).toISOString()); });

  // 2. Book payments that came in but aren't in QuickBooks yet. Ordered by
  //    last attempt (each attempt bumps updated_at) so one stuck row can't
  //    starve the rest.
  const { data: pending } = await admin.from("processor_payments")
    .select("processor_payin_id, status, method")
    .is("qb_payment_id", null)
    .not("qb_invoice_id", "is", null)
    .in("status", [...BOOKABLE_STATUSES])
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

  // 3. Payouts still to book: not sent to the shop for review, not mid-post.
  const { data: payouts } = await admin.from("processor_payouts")
    .select("processor_payout_id, qb_post_error")
    .is("qb_deposit_id", null)
    .is("review_notified_at", null)
    .is("qb_posting_at", null)
    .order("updated_at", { ascending: true })
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
  if (route.route === "deposit" && (!["succeeded", "failed"].includes(String(route.status)) || !route.depositId)) {
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
      return ok({ ok: true, payout: route.status === "failed"
        ? await payoutFailed(deps, String(route.depositId))
        : await processPayout(deps, String(route.depositId)) });
    }

    if (route.route === "dispute_won") {
      if (!route.payinId) return ok({ ok: true, ignored: "no payin id" });
      const payin = await deps.rainforestGet(`/v1/payins/${encodeURIComponent(route.payinId)}`);
      const { data: account } = await admin.from("processor_accounts").select("shop_owner").eq("merchant_id", String(payin?.merchant_id ?? "")).maybeSingle();
      if (account?.shop_owner) {
        const label = payin?.metadata?.quote_number;
        await notifyShop(deps, <Any>{
          shopOwner: account.shop_owner,
          eventType: "payment_dispute_won",
          severity: "info",
          title: `Dispute won${label ? `: ${label}` : ""}`,
          body: "The card network ruled in your favour. The disputed money comes back in a coming payout. Nothing to change in QuickBooks.",
          metadata: { processor: SOURCE, payin_id: route.payinId },
        });
      }
      return ok({ ok: true, disputeWon: true });
    }

    if (route.route === "merchant") {
      if (!route.merchantId) return ok({ ok: true, ignored: "no merchant id" });
      return ok({ ok: true, merchant: await syncMerchant(deps, route.merchantId) });
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

    const applied = await applyPayinEvent(deps, event);
    return ok({ ok: true, ...applied });
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
