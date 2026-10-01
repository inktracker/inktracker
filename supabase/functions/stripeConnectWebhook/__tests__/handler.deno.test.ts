// End-to-end tests for stripeConnectWebhook: REAL handler, fake DB, fake
// Stripe + QuickBooks. Pins: forged requests do nothing, a payment is
// recorded and booked in QuickBooks exactly once, replays are no-ops, a QB
// outage retries without double-posting, unmatched money is kept + flagged,
// and the shop's own (non-InkTracker) Stripe sales are never touched.
// Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";
import { handle, postQbPaymentOnce, sweep, checkPlanLapses, type Deps } from "../index.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

// Built at run time (low entropy, so secret scanners don't flag a fixture).
const SECRET = `whsec_${"t".repeat(32)}`;
const NOW = new Date("2026-10-02T17:00:00Z");
const OWNER = "owner@shop.com";
const QUOTE_ID = "11111111-2222-4333-8444-555555555555";
const ACCT = "acct_1";

async function sign(ts: string, body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`)));
  return Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
}

let evtSeq = 0;
async function request(evt: Any, { forge = false } = {}) {
  const raw = JSON.stringify(evt);
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const v1 = forge ? "0".repeat(64) : await sign(ts, raw);
  return new Request("http://x/stripeConnectWebhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${ts},v1=${v1}` },
    body: raw,
  });
}

const MD = {
  inktracker_doc_type: "quote",
  inktracker_quote_id: QUOTE_ID,
  quote_number: "Q-2026-HKSO",
  shop_owner: OWNER,
  qb_invoice_id: "3815",
  pay_kind: "full",
};
const pi = (over: Record<string, unknown> = {}) => ({
  id: "pi_1",
  object: "payment_intent",
  amount: 164300,
  amount_received: 164300,
  status: "succeeded",
  created: Math.floor(NOW.getTime() / 1000),
  payment_method_types: ["card"],
  metadata: MD,
  ...over,
});
const bankPi = (over: Record<string, unknown> = {}) => pi({ payment_method_types: ["us_bank_account"], ...over });
/** A Stripe event from the shop's connected account. `id` = Stripe's event id (stable across its retries). */
const evt = (type: string, object: Any, id = `evt_${++evtSeq}`, extra: Record<string, unknown> = {}) =>
  ({ id, object: "event", type, account: ACCT, created: Math.floor(NOW.getTime() / 1000), data: { object, ...extra } });

// Stripe's CURRENT state, served by the fake GETs.
let accountNow: Any = { id: ACCT, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } };
const ACTIVE_ACCOUNT = accountNow;

function setup({ qbConnected = true, qbPostFails = false, balance = 1643, payout = null as Any, bts = [] as Any[], live = true, env = {} as Record<string, string> } = {}) {
  const db = fakeSupabase({
    processor_accounts: [{ shop_owner: OWNER, merchant_id: ACCT, merchant_status: "active", enabled: true, qb_bank_account_id: "35", qb_fee_account_id: "88" }],
    processor_payouts: [],
    quotes: [{ id: QUOTE_ID, quote_id: "Q-2026-HKSO", shop_owner: OWNER, qb_invoice_id: "3815", qb_deposit_invoice_id: null }],
    processor_payments: [],
    processed_webhook_events: [],
    notifications: [],
  }, { unique: { processed_webhook_events: ["source", "event_id"], processor_payments: ["processor_payin_id"] } });
  const posted: unknown[] = [];
  const deposits: unknown[] = [];
  const emails: Record<string, Any>[] = [];
  const stripeCalls: { path: string; query?: Any; opts?: Any }[] = [];
  const lists: Record<string, Any[]> = { "/v1/payment_intents/search": [], "/v1/disputes": [], "/v1/payouts": [] };
  let piNow: Any = pi();
  let failNext = qbPostFails;
  const deps: Deps & { setPi: (p: Any) => void; lists: typeof lists; stripeCalls: typeof stripeCalls } = {
    admin: db,
    env: (k) => (k === "STRIPE_CONNECT_WEBHOOK_SECRET" ? SECRET : k === "CRON_SECRET" ? "cron-secret-value" : env[k]),
    now: () => NOW,
    sendEmail: (payload) => { emails.push(payload); return Promise.resolve({ ok: true }); },
    stripe: {
      live,
      oauthToken: () => Promise.reject(new Error("the webhook never connects accounts")),
      deauthorize: () => Promise.reject(new Error("the webhook never disconnects accounts")),
      get: (path: string, query?: Any, opts?: Any) => {
        stripeCalls.push({ path, query, opts });
        if (path === "/v1/payment_intents/search") {
          // Stripe Search: our fake honours the doc-type part of the query.
          const want = /inktracker_doc_type'\]:'(\w+)'/.exec(String(query?.query))?.[1];
          return Promise.resolve({ data: lists[path].filter((p: Any) => p?.metadata?.inktracker_doc_type === want), has_more: false });
        }
        if (path.startsWith("/v1/payment_intents/")) return Promise.resolve(piNow);
        if (path === `/v1/accounts/${ACCT}`) return accountNow instanceof Error ? Promise.reject(accountNow) : Promise.resolve(accountNow);
        if (path.startsWith("/v1/payouts/")) return Promise.resolve(payout);
        if (path === "/v1/balance_transactions") return Promise.resolve({ data: bts, has_more: false });
        if (path in lists) return Promise.resolve({ data: lists[path], has_more: false });
        return Promise.resolve(null);
      },
      post: () => Promise.reject(new Error("the webhook never writes to Stripe")),
    },
    qb: {
      connect: () => Promise.resolve(qbConnected ? { token: "t", realmId: "r" } : null),
      getInvoice: () => Promise.resolve({ Id: "3815", Balance: balance, TotalAmt: 1643, CustomerRef: { value: "61" } }),
      paymentMethods: () => Promise.resolve([{ Id: "3", Name: "Credit Card", Type: "CREDIT_CARD" }, { Id: "7", Name: "ACH" }]),
      recentCustomerPayments: () => Promise.resolve([]),
      postPayment: (_c, body) => {
        if (failNext) { failNext = false; return Promise.reject(new Error("QuickBooks 503")); }
        posted.push(body);
        return Promise.resolve({ Payment: { Id: "501" } });
      },
      postDeposit: (_c, body) => { deposits.push(body); return Promise.resolve({ Deposit: { Id: "901" } }); },
    },
    setPi: (p) => { piNow = p; },
    lists,
    stripeCalls,
  };
  return { db, deps, posted, deposits, emails };
}

Deno.test("forged signature → 401, nothing written", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request(evt("payment_intent.succeeded", pi()), { forge: true }), deps);
  assertEquals(r.status, 401);
  assertEquals(db.writes.length, 0);
  assertEquals(posted.length, 0);
});

Deno.test("card paid → ledger + ONE QuickBooks payment against the invoice; InkTracker's fee recorded", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).posted, "posted");
  const row = db.tables.processor_payments[0];
  assertEquals(row.status, "succeeded");
  assertEquals(row.merchant_id, ACCT);
  assertEquals(row.qb_payment_id, "501");
  assertEquals(row.platform_fee_cents, 118); // 2.99% ($49.13) − Stripe 2.9% + 30¢ ($47.95)
  assertEquals(row.qb_posting_at, null);
  assertEquals(posted.length, 1);
  const body = posted[0] as Record<string, unknown>;
  assertEquals(body.TotalAmt, 1643);
  assertEquals(body.PaymentMethodRef, { value: "3" });
  assertEquals(body.Line, [{ Amount: 1643, LinkedTxn: [{ TxnId: "3815", TxnType: "Invoice" }] }]);
});

Deno.test("the shop's own Stripe sales (no InkTracker metadata) → ignored, nothing written", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request(evt("payment_intent.succeeded", pi({ id: "pi_shopify", metadata: { order_id: "1001" } }))), deps);
  assertEquals((await r.json()).ignored, "not_inktracker");
  assertEquals(db.writes.length, 0);
  assertEquals(posted.length, 0);
  // …including a refund on one (the PaymentIntent is fetched and checked).
  deps.setPi(pi({ id: "pi_shopify", metadata: {} }));
  const ref = await handle(await request(evt("charge.refunded", { payment_intent: "pi_shopify", amount_refunded: 500, refunded: false })), deps);
  assertEquals((await ref.json()).ignored, "not_inktracker");
  assertEquals(db.tables.processor_payments.length, 0);
});

Deno.test("Stripe retrying the SAME event → duplicate; a later event for the same payment → no second post", async () => {
  const { db, deps, posted } = setup();
  const e = evt("payment_intent.succeeded", pi(), "evt_same");
  await handle(await request(e), deps);
  const dup = await handle(await request(e), deps);
  assertEquals((await dup.json()).duplicate, true);
  const again = await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals((await again.json()).posted, null);
  assertEquals(posted.length, 1);
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
});

Deno.test("bank payment: processing records only (shop told it started); succeeded books it", async () => {
  const { db, deps, posted } = setup();
  await handle(await request(evt("payment_intent.processing", bankPi({ status: "processing", amount_received: 0 }))), deps);
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].platform_fee_cents, 993); // 1% ($16.43) − Stripe $5 cap − $1.50 verify
  assert(db.tables.notifications.some((n) => String(n.title).startsWith("Bank payment started")));
  await handle(await request(evt("payment_intent.succeeded", bankPi())), deps);
  assertEquals(posted.length, 1);
  assertEquals((posted[0] as Record<string, unknown>).PaymentMethodRef, { value: "7" });
});

Deno.test("a declined card retried on the same payment: the decline is ignored, the success books", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request(evt("payment_intent.payment_failed", pi({ status: "requires_payment_method" }))), deps);
  assertEquals((await r.json()).ignored, "card_decline_retry");
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
  assertEquals(posted.length, 1);
});

Deno.test("bank login that failed before the payment started → nothing recorded; the retry's success books", async () => {
  const { db, deps, posted } = setup();
  await handle(await request(evt("payment_intent.payment_failed", bankPi({ status: "requires_payment_method" }))), deps);
  assertEquals(db.tables.processor_payments.length, 0);
  await handle(await request(evt("payment_intent.processing", bankPi({ status: "processing" }))), deps);
  await handle(await request(evt("payment_intent.succeeded", bankPi())), deps);
  assertEquals(posted.length, 1);
});

Deno.test("bank payment that started and then failed → shop alerted, invoice stays open", async () => {
  const { db, deps, posted } = setup();
  await handle(await request(evt("payment_intent.processing", bankPi({ status: "processing" }))), deps);
  await handle(await request(evt("payment_intent.payment_failed", bankPi({ status: "requires_payment_method" }))), deps);
  assertEquals(db.tables.processor_payments[0].status, "failed");
  assertEquals(posted.length, 0);
  assert(db.tables.notifications.some((n) => String(n.title).startsWith("Bank payment didn't go through")));
});

Deno.test("QuickBooks down → 500 (Stripe retries), claim released, retry posts once", async () => {
  const { db, deps, posted } = setup({ qbPostFails: true });
  const e = evt("payment_intent.succeeded", pi(), "evt_retry");
  const first = await handle(await request(e), deps);
  assertEquals(first.status, 500);
  assertEquals(db.tables.processor_payments[0].qb_payment_id, undefined);
  assertEquals(db.tables.processor_payments[0].qb_posting_at, null);
  assert(String(db.tables.processor_payments[0].qb_post_error).includes("503"));
  assertEquals(db.tables.processed_webhook_events.length, 0); // released → the retry isn't a "duplicate"
  const retry = await handle(await request(e), deps);
  assertEquals(retry.status, 200);
  assertEquals(posted.length, 1);
  assertEquals(db.tables.processor_payments[0].qb_payment_id, "501");
});

Deno.test("QuickBooks disconnected → money recorded, shop told once (not every night), nothing posted", async () => {
  const { db, deps, posted } = setup({ qbConnected: false });
  const r = await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals(r.status, 200);
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].qb_post_error, "QuickBooks not connected");
  db.tables.processor_payments[0].updated_at = "2026-10-01T00:00:00Z";
  await sweep(deps);
  await sweep(deps);
  assertEquals(db.tables.notifications.filter((n) => n.event_type === "payment_not_booked").length, 1);
});

Deno.test("invoice already paid (two tabs) → posted as an unapplied credit + refund-from-Stripe alert", async () => {
  const { db, deps, posted } = setup({ balance: 0 });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals((posted[0] as Record<string, unknown>).Line, []);
  const n = db.tables.notifications.find((x) => String(x.title).includes("overpaid"));
  assert(n && String(n.body).includes("Stripe dashboard"));
});

Deno.test("metadata pointing at another shop's quote → recorded, NOT booked, shop alerted", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request(evt("payment_intent.succeeded", pi({ metadata: { ...MD, shop_owner: "other@x.com" } }))), deps);
  assertEquals((await r.json()).reject, "shop_mismatch");
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].quote_id, null);
  assert(String(db.tables.notifications[0].title).includes("needs matching"));
});

Deno.test("money on an account no shop owns → nothing written, ops alert", async () => {
  const { db, deps } = setup();
  const e = { ...evt("payment_intent.succeeded", pi()), account: "acct_stranger" };
  const r = await handle(await request(e), deps);
  assertEquals((await r.json()).reject, "unknown_merchant");
  assertEquals(db.tables.processor_payments.length, 0);
});

Deno.test("refunds: partial then full; only THIS refund's size; info notice", async () => {
  const { db, deps } = setup();
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  await handle(await request(evt("charge.refunded", { payment_intent: "pi_1", amount: 164300, amount_refunded: 50000, refunded: false }, undefined, { previous_attributes: { amount_refunded: 0 } })), deps);
  assertEquals(db.tables.processor_payments[0].status, "partially_refunded");
  assert(db.tables.notifications.some((n) => String(n.title).startsWith("Refund issued: $500.00")));
  await handle(await request(evt("charge.refunded", { payment_intent: "pi_1", amount: 164300, amount_refunded: 164300, refunded: true }, undefined, { previous_attributes: { amount_refunded: 50000 } })), deps);
  assertEquals(db.tables.processor_payments[0].status, "refunded");
  assert(db.tables.notifications.some((n) => String(n.title).startsWith("Refund issued: $1143.00")));
});

Deno.test("disputes: card → alert + email pointing at the Stripe dashboard; bank → a return; won → good news", async () => {
  const { db, deps, emails } = setup();
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  await handle(await request(evt("charge.dispute.created", { payment_intent: "pi_1", amount: 164300 })), deps);
  assertEquals(db.tables.processor_payments[0].status, "disputed");
  assertEquals(emails.length, 1);
  assertEquals(emails[0].to, [OWNER]);
  assert(String(emails[0].subject).includes("disputed"));
  assert(String(emails[0].html).includes("Stripe dashboard"));
  await handle(await request(evt("charge.dispute.closed", { payment_intent: "pi_1", amount: 164300, status: "won" })), deps);
  assert(db.tables.notifications.some((n) => n.event_type === "payment_dispute_won"));
  await handle(await request(evt("charge.dispute.closed", { payment_intent: "pi_1", amount: 164300, status: "lost" })), deps);
  assertEquals(db.tables.processor_payments[0].status, "charged_back");

  const bank = setup();
  bank.deps.setPi(bankPi({ latest_charge: { payment_method_details: { type: "us_bank_account" } } }));
  await handle(await request(evt("payment_intent.succeeded", bankPi())), bank.deps);
  await handle(await request(evt("charge.dispute.created", { payment_intent: "pi_1", amount: 164300 })), bank.deps);
  assertEquals(bank.db.tables.processor_payments[0].status, "returned");
});

Deno.test("an email failure never breaks the webhook", async () => {
  const { deps } = setup();
  deps.sendEmail = () => Promise.reject(new Error("Resend down"));
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  const r = await handle(await request(evt("charge.dispute.created", { payment_intent: "pi_1", amount: 100 })), deps);
  assertEquals(r.status, 200);
});

Deno.test("events we don't act on → 200, not claimed", async () => {
  const { db, deps } = setup();
  const r = await handle(await request(evt("customer.created", { id: "cus_1" })), deps);
  assertEquals(r.status, 200);
  assertEquals(db.tables.processed_webhook_events.length, 0);
  const platform = { ...evt("payment_intent.succeeded", pi()), account: undefined };
  assertEquals((await (await handle(await request(platform), deps)).json()).ignored, "platform_event");
});

Deno.test("a stale posting claim (worker died mid-post) is retaken; a fresh one is not", async () => {
  const { db, deps, posted } = setup();
  db.tables.processor_payments.push({ processor_payin_id: "pi_1", shop_owner: OWNER, qb_invoice_id: "3815", amount_cents: 164300, method: "card", status: "succeeded", qb_posting_at: new Date(NOW.getTime() - 60_000).toISOString() });
  assertEquals(await postQbPaymentOnce(deps, "pi_1"), "not_claimed");
  db.tables.processor_payments[0].qb_posting_at = new Date(NOW.getTime() - 11 * 60_000).toISOString();
  assertEquals(await postQbPaymentOnce(deps, "pi_1"), "posted");
  assertEquals(posted.length, 1);
});

Deno.test("QuickBooks lookup failing → nothing posted (no blind double-post), retried later", async () => {
  const { db, deps, posted } = setup();
  deps.qb.recentCustomerPayments = () => Promise.reject(new Error("QuickBooks 500"));
  const r = await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals(r.status, 500);
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].qb_posting_at, null);
});

Deno.test("payment already in QuickBooks (crash after posting) → recorded, not posted again", async () => {
  const { db, deps, posted } = setup();
  deps.qb.recentCustomerPayments = (_c, customerRef) => Promise.resolve(customerRef === "61"
    ? [{ Id: "777", PaymentRefNum: "other" }, { Id: "501", PaymentRefNum: "pi_1" }]
    : []);
  const r = await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  assertEquals((await r.json()).posted, "already_in_qb");
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].qb_payment_id, "501");
});

Deno.test("statuses never move backwards when events race (late 'processing' after 'succeeded')", async () => {
  const { db, deps } = setup();
  await handle(await request(evt("payment_intent.succeeded", bankPi())), deps);
  await handle(await request(evt("payment_intent.processing", bankPi({ status: "processing" }))), deps);
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
});

Deno.test("QuickBooks dates are the shop's calendar date; a bank payment is dated when the customer PAID", async () => {
  const { db, deps, posted } = setup();
  db.tables.shops = [{ owner_email: OWNER, timezone: "America/Los_Angeles" }];
  // Paid 6pm PDT Oct 2 = 01:00 UTC Oct 3; clears Oct 6.
  const paid = Math.floor(new Date("2026-10-03T01:00:00Z").getTime() / 1000);
  await handle(await request(evt("payment_intent.processing", bankPi({ status: "processing", created: paid }))), deps);
  await handle(await request(evt("payment_intent.succeeded", bankPi({ created: paid }))), deps);
  assertEquals((posted[0] as Record<string, unknown>).TxnDate, "2026-10-02");
});

// ── Payouts ─────────────────────────────────────────────────────────────
// $1,643 card: the shop's all-in fee (Stripe + InkTracker) = QB's 2.99% = $49.13.
const cleanPayout = { id: "po_1", object: "payout", status: "paid", amount: 164300 - 4913, created: Math.floor(new Date("2026-10-03T12:00:00Z").getTime() / 1000), arrival_date: Math.floor(new Date("2026-10-03T12:00:00Z").getTime() / 1000) };
const chargeBt = (over: Record<string, unknown> = {}) => ({ id: "txn_1", type: "charge", amount: 164300, fee: 4913, net: 164300 - 4913, source: { id: "ch_1", payment_intent: { id: "pi_1", metadata: MD } }, ...over });
const payoutBt = { id: "txn_po", type: "payout", amount: -(164300 - 4913), fee: 0, source: "po_1" };

Deno.test("payout: ONE QuickBooks deposit that matches the bank, read on the shop's account; replays don't re-book", async () => {
  const { db, deps, deposits } = setup({ payout: cleanPayout, bts: [chargeBt(), payoutBt] });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  const r = await handle(await request(evt("payout.paid", { id: "po_1" })), deps);
  assertEquals((await r.json()).payout, "booked");
  assertEquals(deposits.length, 1);
  const body = deposits[0] as Record<string, Any>;
  assertEquals(body.DepositToAccountRef, { value: "35" });
  assertEquals(body.Line.reduce((a: number, l: Any) => a + Math.round(l.Amount * 100), 0), 164300 - 4913);
  assertEquals(db.tables.processor_payouts[0].qb_deposit_id, "901");
  assertEquals(db.tables.processor_payments[0].processor_payout_id, "po_1");
  const btCall = (deps as Any).stripeCalls.find((c: Any) => c.path === "/v1/balance_transactions");
  assertEquals(btCall.opts.account, ACCT);
  assertEquals(btCall.query.payout, "po_1");
  const out = await sweep(deps);
  assertEquals([out.payouts, out.payoutsBooked, out.errors], [0, 0, 0]);
  assertEquals(deposits.length, 1);
});

Deno.test("payout arriving before its payment is booked → waits, then the sweep books both", async () => {
  const { db, deps, posted, deposits } = setup({ qbPostFails: true, payout: cleanPayout, bts: [chargeBt()] });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps); // QB down → 500
  const r = await handle(await request(evt("payout.paid", { id: "po_1" })), deps);
  assertEquals((await r.json()).payout, "wait");
  assertEquals(deposits.length, 0);
  db.tables.processor_payments[0].updated_at = "2026-10-02T10:00:00Z";
  const out = await sweep(deps);
  assertEquals(out.paymentsBooked, 1);
  assertEquals(out.payoutsBooked, 1);
  assertEquals(posted.length, 1);
  assertEquals(deposits.length, 1);
});

Deno.test("payout with a refund or a non-InkTracker sale → not booked; shop told once", async () => {
  const { db, deps, deposits } = setup({
    payout: { ...cleanPayout, amount: 164300 - 4913 - 5000 + 4855 },
    bts: [chargeBt(), { id: "txn_r", type: "refund", amount: -5000, fee: 0, source: { id: "re_1" } }, chargeBt({ id: "txn_2", amount: 5000, fee: 145, source: { id: "ch_2", payment_intent: { id: "pi_shop", metadata: {} } } })],
  });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  await handle(await request(evt("payout.paid", { id: "po_1" })), deps);
  assertEquals(deposits.length, 0);
  const notes = db.tables.notifications.filter((n) => n.event_type === "payout_needs_review");
  assertEquals(notes.length, 1);
  assert(String(notes[0].body).includes("A refund of $50.00."));
  assert(String(notes[0].body).includes("sale taken in Stripe outside InkTracker"));
  await sweep(deps);
  assertEquals(db.tables.notifications.filter((n) => n.event_type === "payout_needs_review").length, 1);
});

Deno.test("payout stuck mid-post is never re-posted by the sweep", async () => {
  const { db, deps, deposits } = setup({ payout: cleanPayout, bts: [chargeBt()] });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  db.tables.processor_payouts.push({ processor_payout_id: "po_1", shop_owner: OWNER, merchant_id: ACCT, qb_deposit_id: null, qb_posting_at: "2026-10-02T15:00:00Z", review_notified_at: null, created_at: "2026-10-02T15:00:00Z" });
  await sweep(deps);
  assertEquals(deposits.length, 0);
});

Deno.test("QuickBooks 5xx on a Deposit post → claim KEPT, flagged, never retried blind; 400 → released", async () => {
  const { db, deps, deposits } = setup({ payout: cleanPayout, bts: [chargeBt()] });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  deps.qb.postDeposit = () => Promise.reject(Object.assign(new Error("QuickBooks deposit create failed (504): Gateway Time-out"), { status: 504 }));
  const r = await handle(await request(evt("payout.paid", { id: "po_1" })), deps);
  assertEquals((await r.json()).payout, "check_quickbooks");
  assert(db.tables.processor_payouts[0].qb_posting_at);
  deps.qb.postDeposit = (_c, b) => { deposits.push(b); return Promise.resolve({ Deposit: { Id: "999" } }); };
  await sweep(deps);
  assertEquals(deposits.length, 0);

  const second = setup({ payout: cleanPayout, bts: [chargeBt()] });
  await handle(await request(evt("payment_intent.succeeded", pi())), second.deps);
  second.deps.qb.postDeposit = () => Promise.reject(Object.assign(new Error("QuickBooks deposit create failed (400): ValidationFault"), { status: 400 }));
  const r2 = await handle(await request(evt("payout.paid", { id: "po_1" })), second.deps);
  assertEquals(r2.status, 500);
  assertEquals(second.db.tables.processor_payouts[0].qb_posting_at, null);
});

Deno.test("payout returned by the bank after booking → shop told which QB deposit to void", async () => {
  const { db, deps, emails } = setup({ payout: cleanPayout, bts: [chargeBt()] });
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  await handle(await request(evt("payout.paid", { id: "po_1" })), deps);
  await handle(await request(evt("payout.failed", { id: "po_1" })), deps);
  const n = db.tables.notifications.find((x) => x.event_type === "payout_failed");
  assert(n && String(n.body).includes("deposit #901"));
  assert(emails.some((e) => String(e.subject).includes("was returned")));
});

// ── Account status ─────────────────────────────────────────────────────
Deno.test("account approved → goes active; owner told the next step", async () => {
  const { db, deps } = setup();
  db.tables.processor_accounts[0].merchant_status = "onboarding";
  db.tables.processor_accounts[0].enabled = false;
  accountNow = ACTIVE_ACCOUNT;
  await handle(await request(evt("account.updated", { id: ACCT })), deps);
  assertEquals(db.tables.processor_accounts[0].merchant_status, "active");
  assertEquals(db.tables.processor_accounts[0].merchant_application_status, "completed");
  assert(db.tables.notifications.some((n) => n.event_type === "payments_approved"));
});

Deno.test("a stale account event can't overwrite the current status (the account is re-read)", async () => {
  const { db, deps } = setup();
  accountNow = { ...ACTIVE_ACCOUNT, charges_enabled: false, payouts_enabled: false, requirements: { disabled_reason: "platform_paused" } };
  try {
    await handle(await request(evt("account.updated", { id: ACCT, charges_enabled: false })), deps);
    assertEquals(db.tables.processor_accounts[0].merchant_status, "suspended");
    // An OLD "everything enabled" event retried later: its body says live, reality says paused.
    await handle(await request(evt("account.updated", { id: ACCT, charges_enabled: true, payouts_enabled: true })), deps);
    assertEquals(db.tables.processor_accounts[0].merchant_status, "suspended");
  } finally {
    accountNow = ACTIVE_ACCOUNT;
  }
});

Deno.test("switched-on shop paused by Stripe → told to re-send open invoices; a switched-off shop isn't", async () => {
  accountNow = { ...ACTIVE_ACCOUNT, charges_enabled: false, payouts_enabled: false, requirements: { disabled_reason: "platform_paused" } };
  try {
    const { db, deps } = setup();
    await handle(await request(evt("account.updated", { id: ACCT })), deps);
    const n = db.tables.notifications.filter((x) => x.event_type === "payments_account_on_hold");
    assertEquals(n.length, 1);
    assert(String(n[0].body).includes("re-send"));
    const other = setup();
    other.db.tables.processor_accounts[0].enabled = false;
    await handle(await request(evt("account.updated", { id: ACCT })), other.deps);
    assertEquals(other.db.tables.notifications.length, 0);
  } finally {
    accountNow = ACTIVE_ACCOUNT;
  }
});

Deno.test("needs more information → owner alerted (and emailed) once", async () => {
  const { db, deps, emails } = setup();
  db.tables.processor_accounts[0].merchant_status = "onboarding";
  accountNow = { id: ACCT, charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements: { currently_due: ["individual.verification.document"] } };
  try {
    await handle(await request(evt("account.updated", { id: ACCT })), deps);
    await handle(await request(evt("account.updated", { id: ACCT })), deps);
    assertEquals(db.tables.notifications.filter((n) => n.event_type === "payments_needs_information").length, 1);
    assertEquals(emails.length, 1);
  } finally {
    accountNow = ACTIVE_ACCOUNT;
  }
});

Deno.test("shop disconnects InkTracker → switched off at once, back to QuickBooks, owner told", async () => {
  const { db, deps } = setup();
  await handle(await request(evt("account.application.deauthorized", { id: "ca_inktracker" })), deps);
  assertEquals(db.tables.processor_accounts[0].enabled, false);
  assertEquals(db.tables.processor_accounts[0].merchant_status, "canceled");
  assert(db.tables.notifications.some((n) => String(n.title).includes("disconnected")));
  // The nightly sync can no longer read the account → same outcome, told once.
  accountNow = Object.assign(new Error("403 does not have access to account"), { status: 403 });
  try {
    db.tables.processor_accounts[0].merchant_status = "active";
    await sweep(deps);
    assertEquals(db.tables.notifications.filter((n) => String(n.title).includes("disconnected")).length, 2);
    await sweep(deps); // canceled accounts aren't re-synced
    assertEquals(db.tables.notifications.filter((n) => String(n.title).includes("disconnected")).length, 2);
  } finally {
    accountNow = ACTIVE_ACCOUNT;
  }
});

// ── Nightly sweep ──────────────────────────────────────────────────────
Deno.test("sweep: wrong or missing CRON_SECRET → 401; right one runs", async () => {
  const { deps } = setup();
  const bad = await handle(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" }), deps);
  assertEquals(bad.status, 401);
  const good = await handle(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer cron-secret-value" }, body: "{}" }), deps);
  assertEquals(good.status, 200);
  assertEquals((await good.json()).sweep.errors, 0);
});

Deno.test("sweep: bank payments still clearing are left alone", async () => {
  const { db, deps, posted } = setup();
  db.tables.processor_payments.push({ processor_payin_id: "pi_9", shop_owner: OWNER, merchant_id: ACCT, qb_invoice_id: "3815", amount_cents: 1000, method: "ach", status: "processing", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
  await sweep(deps);
  assertEquals(posted.length, 0);
});

Deno.test("backstop: a payment the webhook never recorded (crash after claim) is recorded AND booked overnight", async () => {
  const { db, deps, posted } = setup();
  db.tables.processed_webhook_events.push({ source: "stripe_connect", event_id: "evt:evt_crashed" });
  const dropped = await handle(await request(evt("payment_intent.succeeded", pi(), "evt_crashed")), deps);
  assertEquals((await dropped.json()).duplicate, true);
  assertEquals(db.tables.processor_payments.length, 0);

  (deps as Any).lists["/v1/payment_intents/search"] = [pi(), pi({ id: "pi_shop", metadata: { order_id: "1001" } })];
  const out = await sweep(deps);
  assertEquals(out.backstopReplayed, 1);
  assertEquals(db.tables.processor_payments.length, 1); // only InkTracker's payment
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
  assertEquals(posted.length, 1);
  const again = await sweep(deps);
  assertEquals(again.backstopReplayed, 0);
  assertEquals(posted.length, 1);
});

Deno.test("sweep: a bank payment stuck 'processing' 4+ days is fetched on the shop's account and booked", async () => {
  const { db, deps, posted } = setup();
  db.tables.processor_payments.push({ processor_payin_id: "pi_1", shop_owner: OWNER, merchant_id: ACCT, qb_invoice_id: "3815", quote_id: QUOTE_ID, amount_cents: 164300, method: "ach", status: "processing", created_at: "2026-09-26T17:00:00Z", updated_at: "2026-09-26T17:00:00Z" });
  (deps as Any).setPi(bankPi());
  await sweep(deps);
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
  assertEquals(posted.length, 1);
  assertEquals((deps as Any).stripeCalls.find((c: Any) => c.path === "/v1/payment_intents/pi_1").opts.account, ACCT);
});

Deno.test("sweep: a lost dispute event is caught up once", async () => {
  const { db, deps } = setup();
  await handle(await request(evt("payment_intent.succeeded", pi())), deps);
  (deps as Any).lists["/v1/disputes"] = [{ id: "du_1", payment_intent: "pi_1", amount: 164300, status: "needs_response" }];
  await sweep(deps);
  assertEquals(db.tables.processor_payments[0].status, "disputed");
  await sweep(deps);
  assertEquals(db.tables.notifications.filter((n) => String(n.title).startsWith("Card payment disputed")).length, 1);
});

Deno.test("plan lapse: warned once with the date; paused notice after grace; renewal clears it", async () => {
  const { db, deps, emails } = setup();
  db.tables.profiles = [{ email: OWNER, role: "shop", subscription_tier: "shop", subscription_status: "canceled" }];
  await checkPlanLapses(deps);
  assert(db.tables.processor_accounts[0].plan_lapsed_at);
  await checkPlanLapses(deps);
  assertEquals(db.tables.notifications.filter((n) => n.event_type === "payments_plan_lapsed").length, 1);
  assert(emails.some((e) => String(e.subject).includes("online payments stop on")));

  db.tables.processor_accounts[0].plan_lapsed_at = "2026-09-01T00:00:00Z";
  await checkPlanLapses(deps);
  await checkPlanLapses(deps);
  const paused = db.tables.notifications.filter((n) => n.event_type === "payments_plan_paused");
  assertEquals(paused.length, 1);
  assert(String(paused[0].body).includes("Stripe dashboard"));

  db.tables.profiles[0].subscription_status = "active";
  await checkPlanLapses(deps);
  assertEquals(db.tables.processor_accounts[0].plan_lapsed_at, null);
  assert(db.tables.notifications.some((n) => n.event_type === "payments_plan_renewed"));
});

// ── Test mode and the live switch-over ──────────────────────────────────
Deno.test("test mode: payments are recorded but NEVER posted to the shop's real QuickBooks", async () => {
  const { db, deps, posted, deposits, emails } = setup({ live: false, payout: cleanPayout, bts: [chargeBt()] });
  const testEvt = { ...evt("payment_intent.succeeded", pi()), livemode: false };
  const r = await handle(await request(testEvt), deps);
  assertEquals((await r.json()).posted, "test_mode");
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
  assertEquals(db.tables.processor_payments[0].qb_post_error, "Stripe test mode: not recorded in QuickBooks");
  const p = await handle(await request({ ...evt("payout.paid", { id: "po_1" }), livemode: false }), deps);
  assertEquals((await p.json()).payout, "test_mode");
  db.tables.processor_payments[0].updated_at = "2026-10-01T00:00:00Z";
  await sweep(deps);
  assertEquals(posted.length, 0);
  assertEquals(deposits.length, 0);
  assertEquals(emails.length, 0); // no "not recorded" alarms for test money
});

Deno.test("test mode: booking can be allowed on purpose (a QuickBooks sandbox shop)", async () => {
  const { deps, posted } = setup({ live: false, env: { STRIPE_TEST_BOOKS_TO_QB: "true" } });
  await handle(await request({ ...evt("payment_intent.succeeded", pi()), livemode: false }), deps);
  assertEquals(posted.length, 1);
});

Deno.test("an event from the other Stripe mode is ignored", async () => {
  const { db, deps } = setup(); // live key
  const r = await handle(await request({ ...evt("payment_intent.succeeded", pi()), livemode: false }), deps);
  assertEquals((await r.json()).ignored, "other_mode");
  assertEquals(db.tables.processor_payments.length, 0);
});

Deno.test("going live: test-mode accounts are skipped by the nightly sync (no false 'disconnected' alert)", async () => {
  const { db, deps, emails } = setup(); // live key
  db.tables.processor_accounts[0].stripe_livemode = false;
  accountNow = Object.assign(new Error("404 No such account"), { status: 404 });
  try {
    await sweep(deps);
    assertEquals(db.tables.processor_accounts[0].merchant_status, "active");
    assertEquals(db.tables.notifications.length, 0);
    assertEquals(emails.length, 0);
    assertEquals((deps as Any).stripeCalls.filter((c: Any) => c.path === `/v1/accounts/${ACCT}`).length, 0);
  } finally {
    accountNow = ACTIVE_ACCOUNT;
  }
});

Deno.test("backstop finds InkTracker payments by SEARCH (a busy account's other sales can't crowd them out)", async () => {
  const { deps } = setup();
  await sweep(deps);
  const searches = (deps as Any).stripeCalls.filter((c: Any) => c.path === "/v1/payment_intents/search");
  assertEquals(searches.length, 2); // quotes and invoices
  assert(searches.every((c: Any) => c.opts.account === ACCT && /created>=\d+/.test(c.query.query)));
  assertEquals((deps as Any).stripeCalls.filter((c: Any) => c.path === "/v1/payment_intents").length, 0);
});

Deno.test("a TEST payment recorded before go-live is NEVER booked by a later live sweep", async () => {
  const { db, deps, posted } = setup({ live: false });
  await handle(await request({ ...evt("payment_intent.succeeded", pi({ livemode: false })), livemode: false }), deps);
  assertEquals(db.tables.processor_payments[0].livemode, false);
  // The live key goes in; the nightly sweep runs over the same ledger.
  (deps as Any).stripe.live = true;
  db.tables.processor_payments[0].updated_at = "2026-10-01T00:00:00Z";
  await sweep(deps);
  assertEquals(await postQbPaymentOnce(deps, "pi_1"), "test_mode");
  assertEquals(posted.length, 0);
});

Deno.test("the ledger keeps the fee Stripe ACTUALLY charged, not today's price table", async () => {
  const { db, deps } = setup();
  await handle(await request(evt("payment_intent.succeeded", pi({ application_fee_amount: 99, livemode: true }))), deps);
  assertEquals(db.tables.processor_payments[0].platform_fee_cents, 99);
  assertEquals(db.tables.processor_payments[0].livemode, true);
  const none = setup();
  await handle(await request(evt("payment_intent.succeeded", pi({ application_fee_amount: null }))), none.deps);
  assertEquals(none.db.tables.processor_payments[0].platform_fee_cents, 0);
});

Deno.test("payouts on a Stripe account no shop owns (a deleted shop) are ignored quietly", async () => {
  const { db, deps } = setup({ payout: cleanPayout, bts: [chargeBt()] });
  const r = await handle(await request({ ...evt("payout.paid", { id: "po_1" }), account: "acct_gone" }), deps);
  assertEquals((await r.json()).payout, "unknown_merchant");
  assertEquals(db.tables.processor_payouts.length, 0);
  assertEquals(db.tables.notifications.length, 0);
});
