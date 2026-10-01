// Stripe Connect webhook — Supabase Edge Function (public, no JWT).
//
// A CONNECT endpoint: events from every shop's own Stripe account. Records
// InkTracker's payments in processor_payments and books successful ones into
// the shop's QuickBooks as a Payment against the invoice. QuickBooks' own
// webhook then runs the existing paid pipeline (qbWebhook). Payments the shop
// took in Stripe outside InkTracker (no InkTracker metadata) are ignored.
//
// Order of operations, each step fail-safe:
//   1. Verify Stripe-Signature on the RAW body → else 401.
//   2. Route the event (stripeWebhookAdapter). Non-actionable → 200.
//   3. Claim it in processed_webhook_events (source 'stripe_connect', key =
//      event id). Duplicate → 200. DB unhealthy → 503.
//   4. Apply: account status, or planPayinEffect → ledger, notification,
//      QB post. Any throw → release the claim and 500 so Stripe retries
//      (up to 3 days).
//
// Runs even with STRIPE_PAYMENTS_ENABLED off: that switch stops NEW
// payments; money already taken must still be recorded and booked.
//
// Payouts: payout.paid → one QuickBooks Deposit (clean payouts only;
// anything with refunds/returns/disputes or non-InkTracker sales → the shop
// records it, told once).
//
// Nightly sweep (POST with `Authorization: Bearer CRON_SECRET`, from the
// qb-reconcile GitHub workflow): replays anything missed and retries what
// couldn't be booked at the time.
//
// Secrets: STRIPE_CONNECT_WEBHOOK_SECRET (whsec_… of the Connect endpoint),
// STRIPE_CONNECT_SECRET_KEY, CRON_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2.102.1";
import {
  verifyStripeSignature,
  routeStripeEvent,
  paymentIntentToEvent,
  kindForPaymentIntentStatus,
  methodOfPaymentIntent,
  isOurs,
  accountStatusFields,
  payoutItemsFromBalanceTransactions,
  readStripeList,
} from "../_shared/stripeWebhookAdapter.js";
import { planPayinEffect, planQbApplication, statusesBelow, statusAdvances, BOOKABLE_STATUSES, PAYIN_EVENT } from "../_shared/payinEffect.js";
import { platformFeeCents } from "../_shared/paymentsPricing.js";
import { buildQbPaymentBody, pickQbPaymentMethod, findBookedPayment } from "../_shared/paymentsQbBooks.js";
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
import { planPayoutDeposit, PAYOUT_PLAN } from "../_shared/payoutPlan.js";
import { shopTimezone, localDate } from "../_shared/shopDate.js";
import { isPayingShop } from "../_shared/stripeRequests.js";
import { stripeApi, type StripeApi } from "../_shared/stripeApi.ts";
import { paymentsPauseDate, planGraceOver, flagOn } from "../_shared/paymentRail.js";
import {
  getShopQb,
  qbGetInvoice,
  qbListPaymentMethods,
  qbRecentCustomerPayments,
  qbPost,
  type QbConn,
} from "../_shared/qbShopClient.ts";

const SOURCE = "stripe_connect";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_POST_CLAIM_MS = 10 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type Any = any;

export type Deps = {
  admin: Any;
  env: (k: string) => string | undefined;
  stripe: StripeApi;
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
    if (r && r.ok === false) console.error(`[stripeConnectWebhook] alert email not sent: ${r.reason ?? r.status}`);
  } catch (err) {
    console.error(`[stripeConnectWebhook] alert email threw: ${err}`);
  }
}

// deno-lint-ignore no-explicit-any
function opsAlert(message: string, context: Record<string, unknown> = {}) {
  console.error(`[stripeConnectWebhook] ${message}`, context);
  captureError(new Error(message), { fn: "stripeConnectWebhook", ...context }).catch(() => {});
}

/**
 * May this run write to the shop's QuickBooks? Not in Stripe TEST mode: test
 * payments would land as real payments and deposits in the shop's real
 * books. Allowed only on purpose (STRIPE_TEST_BOOKS_TO_QB=true, e.g. a shop
 * connected to a QuickBooks sandbox company).
 */
function booksAllowed(deps: Deps, livemode?: boolean | null): boolean {
  // The money's own mode wins: a TEST payment recorded before the live key
  // went in must never be booked by a later (live) sweep.
  const live = typeof livemode === "boolean" ? livemode : deps.stripe.live;
  return live || flagOn(deps.env("STRIPE_TEST_BOOKS_TO_QB"));
}
const TEST_MODE_NOT_BOOKED = "Stripe test mode: not recorded in QuickBooks";

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
    .select("processor_payin_id, shop_owner, qb_invoice_id, amount_cents, platform_fee_cents, method, pay_kind, last_event_at, paid_at, quote_id, invoice_id, qb_post_notified_at, livemode");
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

  if (!booksAllowed(deps, row.livemode)) {
    await release({ qb_post_error: TEST_MODE_NOT_BOOKED });
    return "test_mode";
  }

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
        body: "This invoice was already paid when another payment came in. The extra is sitting as a customer credit in QuickBooks. Refund it to the customer from your Stripe dashboard (open the payment, then Refund), then record the refund against the credit in QuickBooks.",
        metadata: { processor: SOURCE, payin_id: payinId, qb_payment_id: qbPaymentId },
      });
    }
    return app.overpaid ? "posted_overpaid" : "posted";
  } catch (err) {
    await release({ qb_post_error: String((err as Error)?.message ?? err).slice(0, 500) });
    throw err;
  }
}

/** Book one Stripe payout into QuickBooks, exactly once. */
export async function processPayout(deps: Deps, accountId: string, payoutId: string): Promise<string> {
  const { admin } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const { data: account } = await admin.from("processor_accounts")
    .select("shop_owner, merchant_id, qb_bank_account_id, qb_fee_account_id")
    .eq("merchant_id", accountId).maybeSingle();
  // A Stripe account no shop owns (e.g. a shop that deleted InkTracker):
  // its payouts are none of our business — note it, don't page anyone.
  if (!account) { console.warn(`[stripeConnectWebhook] payout ${payoutId} for Stripe account ${accountId} that no shop owns — ignored`); return "unknown_merchant"; }
  const po = await deps.stripe.get(`/v1/payouts/${encodeURIComponent(payoutId)}`, undefined, { account: accountId });
  if (!po?.id) return "no_payout";
  const payout = {
    id: String(po.id),
    status: String(po.status ?? ""),
    amountCents: Number(po.amount),
    createdAt: po.created ? new Date(Number(po.created) * 1000).toISOString() : undefined,
  };

  const tz = await loadShopTz(admin, account.shop_owner);
  // The day it reaches the bank — what the bank feed shows.
  const payoutDate = localDate(po.arrival_date ? new Date(Number(po.arrival_date) * 1000).toISOString() : (payout.createdAt ?? now.toISOString()), tz);
  const { data: existing } = await admin.from("processor_payouts")
    .select("qb_deposit_id, review_notified_at").eq("processor_payout_id", payoutId).maybeSingle();
  if (existing?.qb_deposit_id) return "already_booked";
  if (!existing) {
    const { error } = await admin.from("processor_payouts").upsert({
      processor_payout_id: payoutId,
      shop_owner: account.shop_owner,
      merchant_id: accountId,
      net_cents: Number.isInteger(payout.amountCents) ? payout.amountCents : 0,
      payout_date: payoutDate,
      status: payout.status,
      ...(typeof po.livemode === "boolean" ? { livemode: po.livemode } : {}),
    }, { onConflict: "processor_payout_id" });
    if (error) throw new Error(`payout row write failed: ${error.message}`);
  }

  // Stripe test mode: recorded, never booked into the shop's real books, and
  // no "needs recording" alerts for test money. (review_notified_at keeps the
  // nightly sweep from picking it up again.)
  if (!booksAllowed(deps, typeof po.livemode === "boolean" ? po.livemode : null)) {
    await admin.from("processor_payouts").update({ qb_post_error: TEST_MODE_NOT_BOOKED, review_notified_at: now.toISOString(), updated_at: now.toISOString() }).eq("processor_payout_id", payoutId);
    return "test_mode";
  }

  // Everything in the payout, paged. The PaymentIntent is expanded so a sale
  // the shop took outside InkTracker is recognised straight away.
  const bts: Any[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 50; page++) {
    const list = readStripeList(await deps.stripe.get("/v1/balance_transactions", {
      payout: payoutId,
      limit: 100,
      expand: ["data.source", "data.source.payment_intent"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    }, { account: accountId }));
    bts.push(...list.items);
    if (!list.hasMore || !list.lastId) break;
    startingAfter = list.lastId;
  }
  const items = payoutItemsFromBalanceTransactions(bts);
  const payinIds = items.filter((i: Any) => i.type === "payment" && i.payinId).map((i: Any) => String(i.payinId));
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

  const plan: Any = planPayoutDeposit({ payout, items, ledgerByPayin, account, txnDate: payoutDate, now });
  if (plan.plan === PAYOUT_PLAN.SKIP) return `skip:${plan.reason}`;
  if (plan.plan === PAYOUT_PLAN.WAIT) {
    await admin.from("processor_payouts").update({ qb_post_error: "waiting: payments not yet in QuickBooks", updated_at: now.toISOString() }).eq("processor_payout_id", payoutId);
    return "wait";
  }
  if (plan.plan === PAYOUT_PLAN.MANUAL) {
    await admin.from("processor_payouts").update({
      qb_post_error: `needs_review: ${plan.problems.join(" ")}`.slice(0, 1000),
      review_notified_at: existing?.review_notified_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    }).eq("processor_payout_id", payoutId);
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
    .eq("processor_payout_id", payoutId)
    .is("qb_deposit_id", null)
    .is("qb_posting_at", null)
    .select("processor_payout_id");
  if (claimErr) throw new Error(`payout claim failed: ${claimErr.message}`);
  if (!claimed?.length) return "not_claimed";

  let qbDepositId = "";
  try {
    const conn = await deps.qb.connect(account.shop_owner);
    if (!conn) {
      await admin.from("processor_payouts").update({ qb_posting_at: null, qb_post_error: "QuickBooks not connected" }).eq("processor_payout_id", payoutId);
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
        : { qb_post_error: `check_quickbooks: ${msg}` }).eq("processor_payout_id", payoutId);
    } catch { /* surfaced below */ }
    if (!definitelyRejected) {
      opsAlert(`payout ${payoutId}: QuickBooks Deposit may have been created (${msg}) — check QuickBooks before retrying`, { payoutId });
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
      const { error } = await admin.from("processor_payouts").update(patch).eq("processor_payout_id", payoutId);
      recorded = !error;
    } catch { /* retry */ }
  }
  if (!recorded) {
    opsAlert(`payout ${payoutId} POSTED as QuickBooks deposit ${qbDepositId} but not recorded — set processor_payouts.qb_deposit_id by hand`, { payoutId, qbDepositId });
    return "booked_unrecorded";
  }
  await admin.from("processor_payments").update({ processor_payout_id: payoutId })
    .eq("shop_owner", account.shop_owner).in("processor_payin_id", plan.payinIds);
  return "booked";
}

/**
 * The shop disconnected InkTracker from its Stripe account (or the account
 * is gone). Payments switch back to QuickBooks at once; the owner is told.
 */
export async function markDisconnected(deps: Deps, merchantId: string): Promise<string> {
  const { admin } = deps;
  const { data: before } = await admin.from("processor_accounts")
    .select("shop_owner, merchant_status, enabled").eq("merchant_id", merchantId).maybeSingle();
  if (!before) return "unknown_merchant";
  if (before.merchant_status === "canceled" && !before.enabled) return "already_disconnected";
  const now = new Date().toISOString();
  const { error } = await admin.from("processor_accounts").update({
    merchant_status: "canceled", merchant_application_status: "declined", enabled: false, enabled_at: null, updated_at: now,
  }).eq("merchant_id", merchantId);
  if (error) throw new Error(`account update failed: ${error.message}`);
  await notifyShop(deps, <Any>{
    shopOwner: before.shop_owner,
    eventType: "payments_account_on_hold",
    severity: "alert",
    title: "Your Stripe account was disconnected from InkTracker",
    body: "Customers pay through QuickBooks again. Re-send any open quotes or invoices from InkTracker so they get a QuickBooks pay link. To use InkTracker payments again, connect a Stripe account in Account → Payments.",
    metadata: { processor: "stripe" },
  });
  return "disconnected";
}

/**
 * Bring our copy of a shop's Stripe account status up to date. The event
 * body is a snapshot from when it fired, and Stripe retries for days with
 * no ordering guarantee — a retried old "active" landing after a pause
 * would put a paused shop back on InkTracker payments. So the event is only
 * a trigger: read the account's CURRENT state and store that. Also used by
 * the nightly sweep. Tells the owner about changes that matter.
 */
export async function syncMerchant(deps: Deps, merchantId: string): Promise<string> {
  const { admin } = deps;
  const { data: before } = await admin.from("processor_accounts")
    .select("shop_owner, merchant_status, merchant_application_status, enabled, onboarded_at, stripe_livemode")
    .eq("merchant_id", merchantId).maybeSingle();
  if (!before) return "unknown_merchant";
  // Made under the other Stripe mode: not readable with this key, and not
  // "disconnected" either — the owner sets up again (Account → Payments).
  if (!sameMode(deps, before)) return "other_mode";
  let current: Any;
  try {
    current = await deps.stripe.get(`/v1/accounts/${encodeURIComponent(merchantId)}`);
  } catch (err) {
    // The shop disconnected InkTracker (or deleted the account): Stripe no
    // longer lets us read it.
    const st = Number((err as Any)?.status);
    if (st === 403 || st === 404 || (err as Any)?.code === "account_invalid") return await markDisconnected(deps, merchantId);
    throw err;
  }
  const fields: Any = accountStatusFields(current);
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
      body: "Customers pay through QuickBooks again. Quotes and invoices you already sent with an InkTracker pay link can't be paid online until you re-send them from InkTracker, which adds a QuickBooks pay link. Check your Stripe dashboard and your email from Stripe for details.",
      metadata: { processor: SOURCE, merchant_status: ms },
    });
  } else if (app === "needs_information" && before.merchant_application_status !== "needs_information") {
    // Unanswered, the application is auto-canceled after 120 days.
    await notifyShop(deps, <Any>{
      shopOwner: before.shop_owner,
      eventType: "payments_needs_information",
      severity: "alert",
      title: "Your payments sign-up needs more information",
      body: "Stripe needs a bit more information about your business. Open Account → Payments and click Continue sign-up.",
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
 * booking. Shared by the webhook and the nightly Stripe backstop, so a
 * payment is handled identically however we learn about it. Idempotent.
 */
export async function applyPayinEvent(deps: Deps, event: Any): Promise<{ kind: string; reject: string | null; posted: string | null }> {
  const { admin } = deps;
  const { data: account } = await admin.from("processor_accounts")
    .select("shop_owner, merchant_id").eq("merchant_id", event.merchantId).maybeSingle();
  const doc = await loadDoc(admin, event.metadata);
  const { data: ledger } = await admin.from("processor_payments")
    .select("status, method, qb_payment_id, quote_id, invoice_id, qb_invoice_id").eq("processor_payin_id", event.payinId).maybeSingle();

  // What Stripe actually charged when we know it; the price table otherwise.
  const fee = Number.isInteger(event.platformFeeCents) ? event.platformFeeCents
    : event.method ? platformFeeCents(event.method, event.amountCents) : 0;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Connected accounts InkTracker knows, for the per-account backstops — only
 * those made under the Stripe mode in use (a test-mode account doesn't exist
 * under the live key, and vice versa).
 */
async function ourAccounts(deps: Deps): Promise<string[]> {
  const { data } = await deps.admin.from("processor_accounts")
    .select("merchant_id, merchant_status, stripe_livemode").not("merchant_id", "is", null).limit(1000);
  return (data ?? [])
    .filter((a: Any) => a.merchant_status !== "canceled" && sameMode(deps, a))
    .map((a: Any) => String(a.merchant_id));
}

/** Row made under the Stripe mode in use (or from before the mode was recorded). */
function sameMode(deps: Deps, row: Any): boolean {
  return typeof row?.stripe_livemode !== "boolean" || row.stripe_livemode === deps.stripe.live;
}

/**
 * Every InkTracker PaymentIntent on a connected account since `since` (unix),
 * via Search on our metadata — a busy Stripe account's other sales can't
 * crowd ours out of a capped list. Search is eventually consistent (about a
 * minute), which is fine for a nightly backstop.
 */
async function searchOurPaymentIntents(deps: Deps, accountId: string, since: number): Promise<Any[]> {
  const out: Any[] = [];
  for (const docType of ["quote", "invoice"]) {
    let page: string | null = null;
    for (let i = 0; i < 50; i++) {
      const res: Any = await deps.stripe.get("/v1/payment_intents/search", {
        query: `metadata['inktracker_doc_type']:'${docType}' AND created>=${since}`,
        limit: 100,
        ...(page ? { page } : {}),
      }, { account: accountId });
      out.push(...(Array.isArray(res?.data) ? res.data : []));
      if (!res?.has_more || !res?.next_page) break;
      page = String(res.next_page);
    }
  }
  return out;
}

/** Every page of a list on a connected account (starting_after paging). */
async function listAll(deps: Deps, path: string, query: Record<string, unknown>, accountId: string, maxPages = 20): Promise<Any[]> {
  const out: Any[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const list = readStripeList(await deps.stripe.get(path, { limit: 100, ...query, ...(startingAfter ? { starting_after: startingAfter } : {}) }, { account: accountId }));
    out.push(...list.items);
    if (!list.hasMore || !list.lastId) break;
    startingAfter = list.lastId;
  }
  return out;
}

/**
 * Backstop against lost events. The webhook claims an event before
 * processing it; if the function is killed mid-way (timeout, deploy) the
 * claim stays and Stripe's retries are dropped as duplicates, so a payment
 * could exist in Stripe with no ledger row — never recorded, never booked.
 * Each night, list each shop's recent InkTracker PaymentIntents and replay
 * any we're missing or behind on through the same code path. Idempotent.
 */
export async function reconcileRecentPayins(deps: Deps, sinceIso: string): Promise<{ checked: number; replayed: number }> {
  const { admin } = deps;
  const out = { checked: 0, replayed: 0 };
  const since = Math.floor(new Date(sinceIso).getTime() / 1000);
  for (const accountId of await ourAccounts(deps)) {
    const pis = await searchOurPaymentIntents(deps, accountId, since);
    for (const pi of pis) {
      if (!isOurs(pi?.metadata)) continue; // the shop's own non-InkTracker sales
      const kind = kindForPaymentIntentStatus(pi?.status);
      if (!kind || !pi?.id) continue;
      out.checked++;
      const { data: row } = await admin.from("processor_payments").select("status").eq("processor_payin_id", String(pi.id)).maybeSingle();
      if (row && !statusAdvances(row.status, kind)) continue;
      await applyPayinEvent(deps, paymentIntentToEvent(kind, pi, accountId));
      out.replayed++;
      if (!row) opsAlert(`backstop recorded payment ${pi.id} that the webhook never did`, { kind });
    }
  }
  return out;
}

/**
 * Disputes Stripe has that our ledger hasn't caught up with (a lost
 * dispute event). Applied only when the ledger is BEHIND, so the shop is
 * told once — not every night.
 */
async function reconcileRecentDisputes(deps: Deps, sinceIso: string): Promise<number> {
  const { admin } = deps;
  const since = Math.floor(new Date(sinceIso).getTime() / 1000);
  let replayed = 0;
  for (const accountId of await ourAccounts(deps)) {
    for (const d of await listAll(deps, "/v1/disputes", { "created[gte]": since }, accountId, 5)) {
      const payinId = typeof d?.payment_intent === "string" ? d.payment_intent : d?.payment_intent?.id;
      if (!payinId) continue;
      const { data: row } = await admin.from("processor_payments").select("status, method").eq("processor_payin_id", String(payinId)).maybeSingle();
      if (!row) continue; // not an InkTracker payment
      const kind = d.status === "lost" ? PAYIN_EVENT.CHARGED_BACK
        : row.method === "ach" ? PAYIN_EVENT.RETURNED
        : ["won", "warning_closed"].includes(d.status) ? null
        : PAYIN_EVENT.DISPUTED;
      if (!kind || !statusAdvances(row.status, kind)) continue;
      const pi = await deps.stripe.get(`/v1/payment_intents/${encodeURIComponent(payinId)}`, { expand: ["latest_charge"] }, { account: accountId });
      const amt = Number(d.amount);
      await applyPayinEvent(deps, paymentIntentToEvent(kind, pi, accountId, { reversalCents: Number.isInteger(amt) ? amt : undefined }));
      replayed++;
    }
  }
  return replayed;
}

/** Payouts Stripe made that we have no row for (a lost payout event). */
async function reconcileRecentPayouts(deps: Deps, sinceIso: string): Promise<number> {
  const { admin } = deps;
  const since = Math.floor(new Date(sinceIso).getTime() / 1000);
  let found = 0;
  for (const accountId of await ourAccounts(deps)) {
    for (const po of await listAll(deps, "/v1/payouts", { status: "paid", "created[gte]": since }, accountId, 5)) {
      if (!po?.id) continue;
      const { data: row } = await admin.from("processor_payouts").select("processor_payout_id").eq("processor_payout_id", String(po.id)).maybeSingle();
      if (row) continue;
      await processPayout(deps, accountId, String(po.id));
      found++;
    }
  }
  return found;
}

/**
 * A payout the shop's bank returned (wrong account, closed account). If it
 * was already booked in QuickBooks, that Deposit is now money that never
 * arrived — tell the shop exactly which one to void. Stripe sends the money
 * again once the bank details are fixed.
 */
export async function payoutFailed(deps: Deps, accountId: string, payoutId: string): Promise<string> {
  const { admin } = deps;
  const { data: account } = await admin.from("processor_accounts").select("shop_owner").eq("merchant_id", accountId).maybeSingle();
  if (!account) return "unknown_merchant";
  const po = await deps.stripe.get(`/v1/payouts/${encodeURIComponent(payoutId)}`, undefined, { account: accountId });
  const { data: row } = await admin.from("processor_payouts").select("qb_deposit_id").eq("processor_payout_id", payoutId).maybeSingle();
  if (row) {
    await admin.from("processor_payouts").update({ status: "failed", updated_at: new Date().toISOString() }).eq("processor_payout_id", payoutId);
  }
  const amt = Number(po?.amount);
  const money = Number.isInteger(amt) ? `$${(amt / 100).toFixed(2)}` : "A payout";
  await notifyShop(deps, <Any>{
    shopOwner: account.shop_owner,
    eventType: "payout_failed",
    severity: "alert",
    title: `${money} payout to your bank was returned`,
    body: (row?.qb_deposit_id
      ? `InkTracker had recorded it in QuickBooks as deposit #${row.qb_deposit_id}, but the money didn't arrive. Delete or void that deposit in QuickBooks. `
      : "It wasn't recorded in QuickBooks, so there's nothing to change there. ") +
      "Check your bank account in your Stripe dashboard; Stripe sends the money again once it's fixed.",
    metadata: { processor: "stripe", payout_id: payoutId, failure: po?.failure_code ?? null },
  });
  opsAlert(`payout ${payoutId} failed (${po?.failure_code ?? "?"})`, { shop: account.shop_owner });
  return "failed_notified";
}

/**
 * InkTracker plan lapse. A switched-on shop whose plan lapses keeps taking
 * payments on InkTracker for a 14-day grace period (owner warned with the
 * date), then NEW payments go back to QuickBooks pay links. Payouts, refunds
 * and disputes never stop. Renewing clears it.
 */
export async function checkPlanLapses(deps: Deps): Promise<{ lapsed: number; paused: number; renewed: number }> {
  const { admin } = deps;
  const out = { lapsed: 0, paused: 0, renewed: 0 };
  const { data: accts } = await admin.from("processor_accounts")
    .select("shop_owner, enabled, plan_lapsed_at, plan_paused_notified_at")
    .or("enabled.eq.true,plan_lapsed_at.not.is.null")
    .limit(1000);
  const now = new Date();
  for (const a of accts ?? []) {
    const { data: profile } = await admin.from("profiles")
      .select("role, subscription_tier, subscription_status").eq("email", a.shop_owner).maybeSingle();
    if (!profile) continue;
    const paying = isPayingShop(profile);
    if (paying && a.plan_lapsed_at) {
      await admin.from("processor_accounts").update({ plan_lapsed_at: null, plan_paused_notified_at: null, updated_at: now.toISOString() }).eq("shop_owner", a.shop_owner);
      if (a.enabled) {
        await notifyShop(deps, <Any>{
          shopOwner: a.shop_owner, eventType: "payments_plan_renewed", severity: "info",
          title: "InkTracker payments are back on",
          body: "Thanks for renewing. New quotes and invoices you send take payment on InkTracker again.",
          metadata: { processor: SOURCE },
        });
      }
      out.renewed++;
    } else if (!paying && !a.plan_lapsed_at && a.enabled) {
      const lapsedAt = now.toISOString();
      await admin.from("processor_accounts").update({ plan_lapsed_at: lapsedAt, updated_at: lapsedAt }).eq("shop_owner", a.shop_owner);
      const pauseOn = paymentsPauseDate({ plan_lapsed_at: lapsedAt });
      await notifyShop(deps, <Any>{
        shopOwner: a.shop_owner, eventType: "payments_plan_lapsed", severity: "alert",
        title: `Your InkTracker plan has ended: online payments stop on ${pauseOn}`,
        body: `Customers can keep paying on InkTracker until ${pauseOn}. After that, quotes and invoices you send go back to QuickBooks pay links. Your payouts, refunds and dispute tools keep working either way. Renew your plan in Account → Billing & Plan to keep InkTracker payments.`,
        metadata: { processor: SOURCE, pause_on: pauseOn },
      });
      out.lapsed++;
    } else if (!paying && a.plan_lapsed_at && planGraceOver(a, now.getTime()) && !a.plan_paused_notified_at) {
      await admin.from("processor_accounts").update({ plan_paused_notified_at: now.toISOString(), updated_at: now.toISOString() }).eq("shop_owner", a.shop_owner);
      await notifyShop(deps, <Any>{
        shopOwner: a.shop_owner, eventType: "payments_plan_paused", severity: "alert",
        title: "InkTracker payments are paused",
        body: "New quotes and invoices you send now use QuickBooks pay links. Re-send any open ones from InkTracker so customers get a QuickBooks link. Payouts, refunds and disputes keep working in your Stripe dashboard. Renew your plan to switch InkTracker payments back on.",
        metadata: { processor: SOURCE },
      });
      out.paused++;
    }
  }
  return out;
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

  // 0a. InkTracker plan lapses (grace, pause, renewal).
  await step("plan lapse check", async () => { await checkPlanLapses(deps); });

  // 0. Account status, in case an account event was lost.
  await step("merchant sync", async () => {
    const { data: accts } = await admin.from("processor_accounts")
      .select("merchant_id, merchant_status").not("merchant_id", "is", null).limit(500);
    for (const a of accts ?? []) {
      if (["canceled", "deactivated"].includes(String(a.merchant_status))) continue;
      await syncMerchant(deps, String(a.merchant_id));
    }
  });

  // 1. InkTracker payments Stripe has that we don't. 10 days: a bank
  //    payment's clearing (~4 business days) plus a weekend and slack.
  await step("payin backstop", async () => {
    const r = await reconcileRecentPayins(deps, new Date(now.getTime() - 10 * DAY_MS).toISOString());
    out.backstopChecked = r.checked;
    out.backstopReplayed = r.replayed;
  });

  // 1b. Bank payments still "processing" after 4+ days: ask Stripe for the
  //     PaymentIntent directly (its "succeeded" event may have been lost,
  //     and it can fall outside any list window).
  await step("stuck bank payments", async () => {
    const { data: stale } = await admin.from("processor_payments")
      .select("processor_payin_id, merchant_id")
      .eq("status", "processing")
      .eq("method", "ach")
      .lt("created_at", new Date(now.getTime() - 4 * DAY_MS).toISOString())
      .order("created_at", { ascending: true })
      .limit(100);
    for (const r of stale ?? []) {
      const pi = await deps.stripe.get(`/v1/payment_intents/${encodeURIComponent(String(r.processor_payin_id))}`, { expand: ["latest_charge"] }, { account: String(r.merchant_id) });
      // Stripe puts a failed bank payment back to requires_payment_method.
      const kind = kindForPaymentIntentStatus(pi?.status) ??
        (pi?.status === "requires_payment_method" && pi?.last_payment_error ? PAYIN_EVENT.FAILED : null);
      if (kind && kind !== PAYIN_EVENT.PROCESSING) {
        await applyPayinEvent(deps, paymentIntentToEvent(kind, pi, String(r.merchant_id)));
        out.backstopReplayed++;
      }
    }
  });

  // 1c. Lost dispute events, and lost payouts.
  await step("dispute backstop", async () => { out.backstopReplayed += await reconcileRecentDisputes(deps, new Date(now.getTime() - 30 * DAY_MS).toISOString()); });
  await step("payout backstop", async () => { await reconcileRecentPayouts(deps, new Date(now.getTime() - 10 * DAY_MS).toISOString()); });

  // 2. Book payments that came in but aren't in QuickBooks yet. Ordered by
  //    last attempt (each attempt bumps updated_at) so one stuck row can't
  //    starve the rest.
  const { data: pending } = await admin.from("processor_payments")
    .select("processor_payin_id, status, method, livemode")
    .is("qb_payment_id", null)
    .not("qb_invoice_id", "is", null)
    .in("status", [...BOOKABLE_STATUSES])
    .lt("updated_at", olderThan)
    .order("updated_at", { ascending: true })
    .limit(100);
  for (const r of pending ?? []) {
    if (r.status === "processing" && r.method !== "card") continue; // bank not cleared yet
    if (!booksAllowed(deps, r.livemode)) continue; // test money: never booked
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
    .select("processor_payout_id, merchant_id, qb_post_error")
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
      if ((await processPayout(deps, String(p.merchant_id), String(p.processor_payout_id))) === "booked") out.payoutsBooked++;
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
  if (bearer && !req.headers.get("stripe-signature")) {
    if (!sameSecret(bearer, deps.env("CRON_SECRET") ?? "")) return ok({ error: "unauthorized" }, 401);
    try {
      return ok({ ok: true, sweep: await sweep(deps) });
    } catch (err) {
      opsAlert(`sweep failed: ${(err as Error)?.message ?? err}`);
      return ok({ error: "sweep failed" }, 500);
    }
  }

  const rawBody = await req.text();

  const sig = await verifyStripeSignature({
    secret: deps.env("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "",
    rawBody,
    header: req.headers.get("stripe-signature"),
    nowSeconds: Math.floor(((deps.now ?? (() => new Date()))()).getTime() / 1000),
  });
  if (!sig.ok) {
    console.error(`[stripeConnectWebhook] rejected: ${sig.reason}`);
    return ok({ error: "invalid signature" }, 401);
  }

  let evt: Any;
  try { evt = JSON.parse(rawBody); } catch { return ok({ error: "bad json" }, 400); }

  // Test events go to test endpoints and live to live, but guard anyway: a
  // test event must never act under the live configuration (or vice versa).
  if (typeof evt?.livemode === "boolean" && evt.livemode !== deps.stripe.live) return ok({ ok: true, ignored: "other_mode" });
  const route: Any = routeStripeEvent(evt);
  if (route.route === "ignore") return ok({ ok: true, ignored: route.reason });
  if (!evt?.id) return ok({ ok: true, ignored: "no event id" });

  // Stripe's event id is stable across its retries.
  const key = `evt:${evt.id}`;
  const claim = await claimWebhookEventDetailed(admin, SOURCE, key, { event_type: evt?.type });
  if (claim.status === CLAIM_OUTCOMES.DUPLICATE) return ok({ ok: true, duplicate: true });
  if (claim.status === CLAIM_OUTCOMES.ERROR) return ok({ error: "try again" }, 503);

  try {
    if (route.route === "payout") {
      if (!route.payoutId) return ok({ ok: true, ignored: "no payout id" });
      return ok({ ok: true, payout: route.status === "failed"
        ? await payoutFailed(deps, String(route.merchantId), String(route.payoutId))
        : await processPayout(deps, String(route.merchantId), String(route.payoutId)) });
    }

    if (route.route === "merchant") {
      return ok({ ok: true, merchant: await syncMerchant(deps, String(route.merchantId)) });
    }
    if (route.route === "deauthorized") {
      return ok({ ok: true, merchant: await markDisconnected(deps, String(route.merchantId)) });
    }

    if (route.route === "dispute_won") {
      if (!route.payinId) return ok({ ok: true, ignored: "no payment id" });
      const { data: row } = await admin.from("processor_payments").select("shop_owner").eq("processor_payin_id", String(route.payinId)).maybeSingle();
      if (row?.shop_owner) {
        await notifyShop(deps, <Any>{
          shopOwner: row.shop_owner,
          eventType: "payment_dispute_won",
          severity: "info",
          title: "Dispute won",
          body: "The card network ruled in your favour. The disputed money comes back in a coming payout. Nothing to change in QuickBooks.",
          metadata: { processor: "stripe", payin_id: route.payinId },
        });
      }
      return ok({ ok: true, disputeWon: true });
    }

    let event: Any;
    if (route.route === "fetch_payin") {
      if (!route.payinId) return ok({ ok: true, ignored: "no payment id" });
      const pi = await deps.stripe.get(`/v1/payment_intents/${encodeURIComponent(String(route.payinId))}`, { expand: ["latest_charge"] }, { account: String(route.merchantId) });
      if (!isOurs(pi?.metadata)) return ok({ ok: true, ignored: "not_inktracker" });
      // A dispute on a bank payment is a return (the customer's bank pulled
      // it back; there's no evidence process). On a card it's a dispute.
      const kind = route.kind === "dispute_opened"
        ? (methodOfPaymentIntent(pi) === "ach" ? PAYIN_EVENT.RETURNED : PAYIN_EVENT.DISPUTED)
        : String(route.kind);
      event = paymentIntentToEvent(kind, pi, String(route.merchantId), { reversalCents: route.reversalCents });
    } else {
      event = route.event;
    }

    const applied = await applyPayinEvent(deps, event);
    return ok({ ok: true, ...applied });
  } catch (err) {
    await releaseWebhookEvent(admin, SOURCE, key);
    opsAlert(`processing failed: ${(err as Error)?.message ?? err}`, { event_type: evt?.type });
    return ok({ error: "processing failed" }, 500);
  }
}

if (import.meta.main) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const env = (k: string) => Deno.env.get(k);
  Deno.serve((req) => handle(req, {
    admin,
    env,
    stripe: stripeApi(env),
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
