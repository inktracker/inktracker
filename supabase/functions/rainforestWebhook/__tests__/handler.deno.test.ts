// End-to-end tests for rainforestWebhook: REAL handler, fake DB, fake
// Rainforest + QuickBooks. Pins: forged requests do nothing, a payment is
// recorded and booked in QuickBooks exactly once, replays are no-ops, a QB
// outage retries without double-posting, unmatched money is kept + flagged.
// Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";
import { handle, postQbPaymentOnce, sweep, type Deps } from "../index.ts";

const SECRET = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
const NOW = new Date("2026-10-02T17:00:00Z");
const OWNER = "owner@shop.com";
const QUOTE_ID = "11111111-2222-4333-8444-555555555555";

async function sign(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(SECRET.slice(6)), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return "v1," + btoa(String.fromCharCode(...mac));
}

async function request(body: unknown, { forge = false, msgId = "msg_1" } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const sig = forge ? "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : await sign(msgId, ts, raw);
  return new Request("http://x/rainforestWebhook", {
    method: "POST",
    headers: { "svix-id": msgId, "svix-timestamp": ts, "svix-signature": sig },
    body: raw,
  });
}

const payin = (over: Record<string, unknown> = {}) => ({
  payin_id: "pyi_1",
  merchant_id: "mid_1",
  amount: 164300,
  method_type: "CARD",
  refundable_amount: 164300,
  updated_at: NOW.toISOString(),
  metadata: {
    inktracker_doc_type: "quote",
    inktracker_quote_id: QUOTE_ID,
    quote_number: "Q-2026-HKSO",
    shop_owner: OWNER,
    qb_invoice_id: "3815",
    pay_kind: "full",
  },
  ...over,
});

function setup({ qbConnected = true, qbPostFails = false, balance = 1643, deposit = null as Record<string, unknown> | null, activities = [] as unknown[] } = {}) {
  const db = fakeSupabase({
    processor_accounts: [{ shop_owner: OWNER, merchant_id: "mid_1", merchant_status: "active", enabled: true, qb_bank_account_id: "35", qb_fee_account_id: "88" }],
    processor_payouts: [],
    quotes: [{ id: QUOTE_ID, quote_id: "Q-2026-HKSO", shop_owner: OWNER, qb_invoice_id: "3815", qb_deposit_invoice_id: null }],
    processor_payments: [],
    processed_webhook_events: [],
    notifications: [],
  }, { unique: { processed_webhook_events: ["source", "event_id"], processor_payments: ["processor_payin_id"] } });
  const posted: unknown[] = [];
  const deposits: unknown[] = [];
  let failNext = qbPostFails;
  const deps: Deps = {
    admin: db,
    env: (k) => (k === "RAINFOREST_WEBHOOK_SECRET" ? SECRET : k === "CRON_SECRET" ? "cron-secret-value" : undefined),
    now: () => NOW,
    rainforestGet: (path) => {
      if (path.endsWith("/pyi_1")) return Promise.resolve(payin({ refundable_amount: 0 }));
      if (path.includes("/activity")) return Promise.resolve({ activities: path.includes("offset=0") ? activities : [] });
      if (path.startsWith("/v1/deposits/")) return Promise.resolve(deposit);
      return Promise.resolve(null);
    },
    qb: {
      connect: () => Promise.resolve(qbConnected ? { token: "t", realmId: "r" } : null),
      getInvoice: () => Promise.resolve({ Id: "3815", Balance: balance, TotalAmt: 1643, CustomerRef: { value: "61" } }),
      paymentMethods: () => Promise.resolve([{ Id: "3", Name: "Credit Card", Type: "CREDIT_CARD" }, { Id: "7", Name: "ACH" }]),
      findPaymentByRef: () => Promise.resolve(null),
      postPayment: (_c, body) => {
        if (failNext) { failNext = false; return Promise.reject(new Error("QuickBooks 503")); }
        posted.push(body);
        return Promise.resolve({ Payment: { Id: "501" } });
      },
      postDeposit: (_c, body) => { deposits.push(body); return Promise.resolve({ Deposit: { Id: "901" } }); },
    },
  };
  return { db, deps, posted, deposits };
}

Deno.test("forged signature → 401, nothing written", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request({ event_type: "payin.processing", data: payin() }, { forge: true }), deps);
  assertEquals(r.status, 401);
  assertEquals(db.writes.length, 0);
  assertEquals(posted.length, 0);
});

Deno.test("card captured → ledger + ONE QuickBooks payment against the invoice", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).posted, "posted");
  const row = db.tables.processor_payments[0];
  assertEquals(row.status, "processing");
  assertEquals(row.qb_payment_id, "501");
  assertEquals(row.platform_fee_cents, 4913); // 2.99% of $1,643.00
  assertEquals(row.qb_posting_at, null);
  assertEquals(posted.length, 1);
  const body = posted[0] as Record<string, unknown>;
  assertEquals(body.TotalAmt, 1643);
  assertEquals(body.PaymentMethodRef, { value: "3" });
  assertEquals(body.Line, [{ Amount: 1643, LinkedTxn: [{ TxnId: "3815", TxnType: "Invoice" }] }]);
});

Deno.test("replayed event and the later 'succeeded' → still ONE QuickBooks payment", async () => {
  const { db, deps, posted } = setup();
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  // Rainforest retrying the SAME message → dropped as a duplicate.
  const dup = await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals((await dup.json()).duplicate, true);
  // A separate message with the same content → processed, but a no-op.
  const again = await handle(await request({ event_type: "payin.processing", data: payin() }, { msgId: "msg_2" }), deps);
  assertEquals((await again.json()).posted, null);
  await handle(await request({ event_type: "payin.succeeded", data: payin() }, { msgId: "msg_3" }), deps);
  assertEquals(posted.length, 1);
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
});

Deno.test("bank payment: processing records only; succeeded books it", async () => {
  const { db, deps, posted } = setup();
  await handle(await request({ event_type: "payin.processing", data: payin({ method_type: "ACH" }) }), deps);
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].platform_fee_cents, 1643); // 1%
  await handle(await request({ event_type: "payin.succeeded", data: payin({ method_type: "ACH" }) }, { msgId: "m2" }), deps);
  assertEquals(posted.length, 1);
  assertEquals((posted[0] as Record<string, unknown>).PaymentMethodRef, { value: "7" });
});

Deno.test("QuickBooks down → 500 (Rainforest retries), claim released, retry posts once", async () => {
  const { db, deps, posted } = setup({ qbPostFails: true });
  const first = await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals(first.status, 500);
  assertEquals(db.tables.processor_payments[0].qb_payment_id, undefined);
  assertEquals(db.tables.processor_payments[0].qb_posting_at, null);
  assert(String(db.tables.processor_payments[0].qb_post_error).includes("503"));
  assertEquals(db.tables.processed_webhook_events.length, 0); // released → the retry isn't a "duplicate"
  const retry = await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals(retry.status, 200);
  assertEquals(posted.length, 1);
  assertEquals(db.tables.processor_payments[0].qb_payment_id, "501");
});

Deno.test("QuickBooks disconnected → money recorded, shop told, nothing posted", async () => {
  const { db, deps, posted } = setup({ qbConnected: false });
  const r = await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals(r.status, 200);
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].qb_post_error, "QuickBooks not connected");
  assert(String(db.tables.notifications[0].title).includes("not recorded in QuickBooks"));
});

Deno.test("invoice already paid (two tabs) → posted as an unapplied credit + refund alert", async () => {
  const { db, deps, posted } = setup({ balance: 0 });
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals((posted[0] as Record<string, unknown>).Line, []);
  assert(db.tables.notifications.some((n) => String(n.title).includes("overpaid")));
});

Deno.test("metadata pointing at another shop's quote → recorded, NOT booked, shop alerted", async () => {
  const { db, deps, posted } = setup();
  const r = await handle(await request({ event_type: "payin.processing", data: payin({ metadata: { ...payin().metadata, shop_owner: "other@x.com" } }) }), deps);
  assertEquals((await r.json()).reject, "shop_mismatch");
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].quote_id, null);
  assert(String(db.tables.notifications[0].title).includes("needs matching"));
});

Deno.test("full refund → fetches the payin, marks refunded, info notice", async () => {
  const { db, deps } = setup();
  await handle(await request({ event_type: "payin.succeeded", data: payin() }), deps);
  await handle(await request({ event_type: "refund.succeeded", data: { refund_id: "rfd_1", payin_id: "pyi_1", amount: 164300 } }, { msgId: "m2" }), deps);
  assertEquals(db.tables.processor_payments[0].status, "refunded");
  assert(db.tables.notifications.some((n) => String(n.title).startsWith("Refund issued: $1643.00")));
});

Deno.test("merchant approved → account goes active (rail can flip)", async () => {
  const { db, deps } = setup();
  db.tables.processor_accounts[0].merchant_status = "onboarding";
  await handle(await request({ event_type: "merchant.active", data: { merchant_id: "mid_1", status: "ACTIVE" } }), deps);
  assertEquals(db.tables.processor_accounts[0].merchant_status, "active");
});

Deno.test("events we don't act on → 200, not claimed", async () => {
  const { db, deps } = setup();
  const r = await handle(await request({ event_type: "payin.authorized", data: payin() }), deps);
  assertEquals(r.status, 200);
  assertEquals(db.tables.processed_webhook_events.length, 0);
});

Deno.test("a stale posting claim (worker died mid-post) is retaken; a fresh one is not", async () => {
  const { db, deps, posted } = setup();
  db.tables.processor_payments.push({ processor_payin_id: "pyi_1", shop_owner: OWNER, qb_invoice_id: "3815", amount_cents: 164300, method: "card", status: "processing", qb_posting_at: new Date(NOW.getTime() - 60_000).toISOString() });
  assertEquals(await postQbPaymentOnce(deps, "pyi_1"), "not_claimed"); // another worker is on it
  db.tables.processor_payments[0].qb_posting_at = new Date(NOW.getTime() - 11 * 60_000).toISOString();
  assertEquals(await postQbPaymentOnce(deps, "pyi_1"), "posted");
  assertEquals(posted.length, 1);
});

// ── Payouts ─────────────────────────────────────────────────────────────
const cleanDeposit = { deposit_id: "dep_1", merchant_id: "mid_1", status: "SUCCEEDED", deposit_type: "FUNDING", amount: 164300 - 4913, created_at: "2026-10-03T12:00:00Z", deposit_fee_amount: { amount: 0 } };
const payinActivity = { id: "pyi_1", type: "PAYIN", gross_amount: { amount: 164300 }, billing_fees_amount: { amount: -4913 } };

Deno.test("payout: booked as ONE QuickBooks deposit that matches the bank; replays don't re-book", async () => {
  const { db, deps, deposits } = setup({ deposit: cleanDeposit, activities: [payinActivity] });
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  const r = await handle(await request({ event_type: "deposit.succeeded", data: { deposit_id: "dep_1" } }, { msgId: "d1" }), deps);
  assertEquals((await r.json()).payout, "booked");
  assertEquals(deposits.length, 1);
  const body = deposits[0] as Record<string, any>;
  assertEquals(body.DepositToAccountRef, { value: "35" });
  assertEquals(body.Line.reduce((a: number, l: any) => a + Math.round(l.Amount * 100), 0), 164300 - 4913);
  assertEquals(db.tables.processor_payouts[0].qb_deposit_id, "901");
  assertEquals(db.tables.processor_payments[0].processor_payout_id, "dep_1");
  // A later retry of the same payout (e.g. the sweep) books nothing new.
  assertEquals(await sweep(deps), { payments: 0, paymentsBooked: 0, payouts: 0, payoutsBooked: 0, errors: 0 });
  assertEquals(deposits.length, 1);
});

Deno.test("payout arriving before its payment is booked → waits, then the sweep books both", async () => {
  const { db, deps, posted, deposits } = setup({ qbPostFails: true, deposit: cleanDeposit, activities: [payinActivity] });
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps); // QB down → 500
  const r = await handle(await request({ event_type: "deposit.succeeded", data: { deposit_id: "dep_1" } }, { msgId: "d1" }), deps);
  assertEquals((await r.json()).payout, "wait");
  assertEquals(deposits.length, 0);
  db.tables.processor_payments[0].updated_at = "2026-10-02T10:00:00Z"; // older than 30 min
  const out = await sweep(deps);
  assertEquals(out.paymentsBooked, 1);
  assertEquals(out.payoutsBooked, 1);
  assertEquals(posted.length, 1);
  assertEquals(deposits.length, 1);
});

Deno.test("payout with a refund → not booked; shop told once", async () => {
  const withRefund = { ...cleanDeposit, amount: 164300 - 4913 - 5000 };
  const { db, deps, deposits } = setup({ deposit: withRefund, activities: [payinActivity, { id: "rfd_1", type: "REFUND", gross_amount: { amount: -5000 } }] });
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  await handle(await request({ event_type: "deposit.succeeded", data: { deposit_id: "dep_1" } }, { msgId: "d1" }), deps);
  assertEquals(deposits.length, 0);
  const notes = db.tables.notifications.filter((n) => n.event_type === "payout_needs_review");
  assertEquals(notes.length, 1);
  assert(String(notes[0].body).includes("A refund of $50.00."));
  await sweep(deps); // skips needs_review payouts — no second notice
  assertEquals(db.tables.notifications.filter((n) => n.event_type === "payout_needs_review").length, 1);
});

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
  db.tables.processor_payments.push({ processor_payin_id: "pyi_9", shop_owner: OWNER, qb_invoice_id: "3815", amount_cents: 1000, method: "ach", status: "processing", updated_at: "2026-10-01T00:00:00Z" });
  await sweep(deps);
  assertEquals(posted.length, 0);
});

Deno.test("merchant suspended, reactivated, suspended again → each change applies (message-level dedupe)", async () => {
  const { db, deps } = setup();
  for (const [i, st] of ["SUSPENDED", "ACTIVE", "SUSPENDED"].entries()) {
    await handle(await request({ event_type: `merchant.${st.toLowerCase()}`, data: { merchant_id: "mid_1", status: st } }, { msgId: `m${i}` }), deps);
  }
  assertEquals(db.tables.processor_accounts[0].merchant_status, "suspended");
});

Deno.test("QuickBooks lookup failing → nothing posted (no blind double-post), retried later", async () => {
  const { db, deps, posted } = setup();
  deps.qb.findPaymentByRef = () => Promise.reject(new Error("QuickBooks 500"));
  const r = await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  assertEquals(r.status, 500);
  assertEquals(posted.length, 0);
  assertEquals(db.tables.processor_payments[0].qb_posting_at, null);
});

Deno.test("statuses never move backwards when events race", async () => {
  const { db, deps } = setup();
  await handle(await request({ event_type: "payin.succeeded", data: payin() }), deps);
  // A late 'processing' whose read raced ahead of the succeeded write:
  // simulate by sending it with a stale ledger view.
  const row = db.tables.processor_payments[0];
  assertEquals(row.status, "succeeded");
  await handle(await request({ event_type: "payin.processing", data: payin() }, { msgId: "late" }), deps);
  assertEquals(db.tables.processor_payments[0].status, "succeeded");
});

Deno.test("QB disconnected: shop told once, not every night", async () => {
  const { db, deps } = setup({ qbConnected: false });
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  db.tables.processor_payments[0].updated_at = "2026-10-01T00:00:00Z";
  await sweep(deps);
  await sweep(deps);
  assertEquals(db.tables.notifications.filter((n) => n.event_type === "payment_not_booked").length, 1);
});

Deno.test("payout stuck mid-post is never re-posted by the sweep", async () => {
  const { db, deps, deposits } = setup({ deposit: cleanDeposit, activities: [payinActivity] });
  await handle(await request({ event_type: "payin.processing", data: payin() }), deps);
  db.tables.processor_payouts.push({ processor_payout_id: "dep_1", shop_owner: OWNER, merchant_id: "mid_1", qb_deposit_id: null, qb_posting_at: "2026-10-02T15:00:00Z", review_notified_at: null, created_at: "2026-10-02T15:00:00Z" });
  await sweep(deps);
  assertEquals(deposits.length, 0);
});

Deno.test("switched-on shop suspended → told to re-send open invoices; a pending shop isn't", async () => {
  const { db, deps } = setup();
  await handle(await request({ event_type: "merchant.suspended", data: { merchant_id: "mid_1", status: "SUSPENDED" } }), deps);
  const n = db.tables.notifications.filter((x) => x.event_type === "payments_account_on_hold");
  assertEquals(n.length, 1);
  assert(String(n[0].body).includes("re-send"));
  const other = setup();
  other.db.tables.processor_accounts[0].enabled = false;
  await handle(await request({ event_type: "merchant.suspended", data: { merchant_id: "mid_1", status: "SUSPENDED" } }), other.deps);
  assertEquals(other.db.tables.notifications.length, 0);
});
