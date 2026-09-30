// End-to-end tests for rainforestWebhook: REAL handler, fake DB, fake
// Rainforest + QuickBooks. Pins: forged requests do nothing, a payment is
// recorded and booked in QuickBooks exactly once, replays are no-ops, a QB
// outage retries without double-posting, unmatched money is kept + flagged.
// Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";
import { handle, postQbPaymentOnce, type Deps } from "../index.ts";

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

function setup({ qbConnected = true, qbPostFails = false, balance = 1643 } = {}) {
  const db = fakeSupabase({
    processor_accounts: [{ shop_owner: OWNER, merchant_id: "mid_1", merchant_status: "active", enabled: true }],
    quotes: [{ id: QUOTE_ID, quote_id: "Q-2026-HKSO", shop_owner: OWNER, qb_invoice_id: "3815", qb_deposit_invoice_id: null }],
    processor_payments: [],
    processed_webhook_events: [],
    notifications: [],
  }, { unique: { processed_webhook_events: ["source", "event_id"] } });
  const posted: unknown[] = [];
  let failNext = qbPostFails;
  const deps: Deps = {
    admin: db,
    env: (k) => (k === "RAINFOREST_WEBHOOK_SECRET" ? SECRET : undefined),
    now: () => NOW,
    rainforestGet: (path) => Promise.resolve(path.endsWith("/pyi_1") ? payin({ refundable_amount: 0 }) : null),
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
    },
  };
  return { db, deps, posted };
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
  const dup = await handle(await request({ event_type: "payin.processing", data: payin() }, { msgId: "msg_2" }), deps);
  assertEquals((await dup.json()).duplicate, true);
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
