// Handler tests for the `rainforest` edge function: the REAL handler against
// the in-memory fake DB. Pins who can see/change InkTracker payments, that the
// kill switch wins, and that the shop OWNER's row is the one acted on.
// Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";
import { handle } from "../index.ts";

const OWNER = "owner@shop.com";

function db(account: Record<string, unknown> | null = null) {
  return fakeSupabase({
    profiles: [
      { id: "own-id", auth_id: "own-auth", email: OWNER, role: "shop", shop_owner: null, shop_name: "Biota Mfg", subscription_tier: "shop", subscription_status: "active", zip: "89502" },
      { id: "mgr-id", auth_id: "mgr-auth", email: "mgr@shop.com", role: "manager", shop_owner: OWNER },
      { id: "emp-id", auth_id: "emp-auth", email: "emp@shop.com", role: "employee", shop_owner: OWNER },
      { id: "brk-id", auth_id: "brk-auth", email: "broker@x.com", role: "broker", shop_owner: null, assigned_shops: [OWNER] },
    ],
    profile_secrets: [],
    processor_accounts: account ? [{ shop_owner: OWNER, ...account }] : [],
  });
}

const ACTIVE = { merchant_id: "mid_1", merchant_status: "active", enabled: false, qb_bank_account_id: "35", qb_fee_account_id: "88" };
const QUOTE_ID = "11111111-2222-4333-8444-555555555555";

function withQuote(account: Record<string, unknown> | null, quote: Record<string, unknown> = {}, payments: Record<string, unknown>[] = []) {
  const fake = db(account);
  fake.tables.quotes = [{ id: QUOTE_ID, quote_id: "Q-2026-HKSO", shop_owner: OWNER, status: "Sent", total: 1643, tax: 0, qb_invoice_id: "3815", public_token: "tok", customer_name: "Tahoe Gift Co", ...quote }];
  fake.tables.processor_payments = payments;
  return fake;
}

type RfCall = { method: string; path: string; body?: unknown };

function fakeRf(calls: RfCall[] = []) {
  return {
    base: "https://api.sandbox.rainforestpay.com",
    get: (path: string) => {
      calls.push({ method: "GET", path });
      if (path.startsWith("/v1/merchants?")) return Promise.resolve({ results: existingMerchants });
      return Promise.resolve({ merchant_id: "mid_1", merchant_status: "ACTIVE", merchant_application_status: "COMPLETED" });
    },
    post: (path: string, body?: unknown) => {
      calls.push({ method: "POST", path, body });
      if (path === "/v1/merchants") return Promise.resolve({ merchant_id: "mid_new", merchant_application_id: "app_new", merchant_status: "PENDING", merchant_application_status: "CREATED" });
      if (path === "/v1/sessions") return Promise.resolve({ session_key: "session_abc" });
      if (path === "/v1/payin_configs") return Promise.resolve({ payin_config_id: "cfg_1" });
      return Promise.resolve({});
    },
  };
}

let liveInvoice: Record<string, unknown> | null = null;
let existingMerchants: Record<string, unknown>[] = [];
let qbConnected = true;

function call(fake: unknown, authId: string, body: Record<string, unknown>, env: Record<string, string> = { RAINFOREST_ENABLED: "true" }, rfCalls: RfCall[] = []) {
  const req = new Request("http://x/rainforest", {
    method: "POST",
    headers: authId ? { Authorization: "Bearer t" } : {},
    body: JSON.stringify(body),
  });
  return handle(req, {
    admin: fake,
    getUser: () => Promise.resolve(authId ? { id: authId } : null),
    env: (k) => env[k],
    rf: fakeRf(rfCalls),
    qb: {
      connect: () => Promise.resolve(qbConnected ? { token: "t", realmId: "r" } : null),
      listAccounts: () => Promise.resolve([]),
      getInvoice: () => Promise.resolve(liveInvoice),
    },
  });
}

Deno.test("no session → 401; broker → 403", async () => {
  assertEquals((await call(db(), "", { action: "status" })).status, 401);
  assertEquals((await call(db(), "brk-auth", { action: "status" })).status, 403);
});

Deno.test("status: kill switch off → QuickBooks rail even for a fully enabled shop", async () => {
  const r = await call(db({ ...ACTIVE, enabled: true }), "own-auth", { action: "status" }, {});
  const j = await r.json();
  assertEquals(j.platformEnabled, false);
  assertEquals(j.rail, "qb");
});

Deno.test("status: enabled + active → processor rail; never leaks the merchant id", async () => {
  const r = await call(db({ ...ACTIVE, enabled: true }), "emp-auth", { action: "status" });
  const j = await r.json();
  assertEquals(j.rail, "processor");
  assertEquals(j.stage, "active");
  assertEquals(j.pricing.card, "2.99%");
  assertEquals(j.pricing.ach, "1%");
  assertEquals(j.canToggle, false); // employee
  assert(!JSON.stringify(j).includes("mid_1"));
});

Deno.test("setEnabled: owner only", async () => {
  const fake = db(ACTIVE);
  assertEquals((await call(fake, "mgr-auth", { action: "setEnabled", enabled: true })).status, 400);
  assertEquals((await call(fake, "mgr-auth", { action: "setEnabled", enabled: false })).status, 403);
  assertEquals(fake.writes.length, 0);
});

Deno.test("setEnabled: owner turns it on → writes the OWNER's row, rail flips", async () => {
  const fake = db(ACTIVE);
  const r = await call(fake, "own-auth", { action: "setEnabled", enabled: true });
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(j.rail, "processor");
  assertEquals(fake.writes.length, 1);
  assertEquals(fake.writes[0].table, "processor_accounts");
  assertEquals(fake.writes[0].patch?.enabled, true);
  assertEquals(fake.writes[0].filters.map((f) => `${f.col}=${f.val}`), [`shop_owner=${OWNER}`]);
});

Deno.test("setEnabled: refused while under review, without QB accounts, or with the kill switch off", async () => {
  const review = await call(db({ ...ACTIVE, merchant_status: "onboarding", merchant_application_status: "processing" }), "own-auth", { action: "setEnabled", enabled: true });
  assertEquals(review.status, 400);
  assert((await review.json()).error.includes("reviewed"));

  const noAccts = await call(db({ ...ACTIVE, qb_fee_account_id: null }), "own-auth", { action: "setEnabled", enabled: true });
  assert((await noAccts.json()).error.includes("QuickBooks"));

  const off = await call(db(ACTIVE), "own-auth", { action: "setEnabled", enabled: true }, {});
  assert((await off.json()).error.includes("aren't available"));
});

Deno.test("setEnabled false: always allowed for the owner (back to QuickBooks)", async () => {
  const fake = db({ ...ACTIVE, enabled: true, merchant_status: "declined" });
  const r = await call(fake, "own-auth", { action: "setEnabled", enabled: false }, {});
  assertEquals(r.status, 200);
  assertEquals((await r.json()).rail, "qb");
});

Deno.test("saveQbAccounts: employee refused; no QuickBooks connection → 400", async () => {
  assertEquals((await call(db(), "emp-auth", { action: "saveQbAccounts", bankAccountId: "35", feeAccountId: "88" })).status, 403);
  qbConnected = false;
  try {
    const r = await call(db(), "mgr-auth", { action: "saveQbAccounts", bankAccountId: "35", feeAccountId: "88" });
    assertEquals(r.status, 400);
    assert((await r.json()).error.includes("Connect QuickBooks"));
  } finally {
    qbConnected = true;
  }
});

Deno.test("unknown action → 400", async () => {
  assertEquals((await call(db(), "own-auth", { action: "wireMoney" })).status, 400);
});

// ── startOnboarding ─────────────────────────────────────────────────────
Deno.test("startOnboarding: owner on a paid plan → merchant created ONCE (prefilled), then resumed", async () => {
  const fake = db(null);
  const calls: RfCall[] = [];
  const r = await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls);
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(j.sessionKey, "session_abc");
  assertEquals(j.merchantId, "mid_new");
  assertEquals(j.scriptUrl, "https://static.rainforestpay.com/sandbox.merchant.js");
  const created = calls.find((c) => c.path === "/v1/merchants")!.body as Record<string, unknown>;
  assertEquals(created.name, "Biota Mfg");
  assertEquals(created.email, OWNER);
  assert(!("tax_id" in created) && !("owner_1" in created)); // never sensitive data
  const sess = calls.find((c) => c.path === "/v1/sessions")!.body as Record<string, unknown>;
  assertEquals(JSON.stringify(sess), JSON.stringify({ ttl: 3600, statements: [{ permissions: ["group#merchant_onboarding_component"], constraints: { merchant: { merchant_id: "mid_new" } } }] }));
  assertEquals(fake.tables.processor_accounts[0].merchant_id, "mid_new");

  const again: RfCall[] = [];
  await call(fake, "own-auth", { action: "startOnboarding" }, undefined, again);
  assertEquals(again.filter((c) => c.path === "/v1/merchants").length, 0); // resumed, not duplicated
});

Deno.test("startOnboarding: manager, trial shop, or kill switch off → refused", async () => {
  assertEquals((await call(db(null), "mgr-auth", { action: "startOnboarding" })).status, 403);
  const trial = db(null);
  trial.tables.profiles[0].subscription_tier = "trial";
  trial.tables.profiles[0].subscription_status = "trialing";
  const r = await call(trial, "own-auth", { action: "startOnboarding" });
  assertEquals(r.status, 403);
  assert((await r.json()).error.includes("paid plan"));
  assertEquals((await call(db(null), "own-auth", { action: "startOnboarding" }, {})).status, 400);
});

// ── payinSession (public) ───────────────────────────────────────────────
Deno.test("payinSession: wrong token or unknown id → the same 404", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, CustomerRef: { value: "61" }, Line: [] };
  const fake = withQuote({ ...ACTIVE, enabled: true });
  assertEquals((await call(fake, "", { action: "payinSession", id: QUOTE_ID, token: "nope" })).status, 404);
  assertEquals((await call(fake, "", { action: "payinSession", id: "not-a-uuid", token: "tok" })).status, 404);
  assertEquals((await call(fake, "", { action: "payinSession", id: QUOTE_ID })).status, 404);
});

Deno.test("payinSession: shop not switched on (or kill switch off) → keep using QuickBooks", async () => {
  const fake = withQuote(ACTIVE); // enabled: false
  assertEquals(await (await call(fake, "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json(), { rail: "qb" });
  const on = withQuote({ ...ACTIVE, enabled: true });
  assertEquals(await (await call(on, "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, {})).json(), { rail: "qb" });
});

Deno.test("payinSession: charges the LIVE QuickBooks balance with a merchant-scoped session", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1499.01, TxnTaxDetail: { TotalTax: 0 }, CustomerRef: { value: "61" }, Line: [] };
  const calls: RfCall[] = [];
  const r = await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls);
  const j = await r.json();
  assertEquals(j.payable, true);
  assertEquals(j.amountCents, 149901);
  assertEquals(j.kind, "balance");
  assertEquals(j.payinConfigId, "cfg_1");
  assertEquals(j.scriptUrl, "https://static.rainforestpay.com/sandbox.payment.js");
  const cfg = calls.find((c) => c.path === "/v1/payin_configs")!.body as Record<string, any>;
  assertEquals(cfg.amount, 149901);
  assertEquals(cfg.merchant_id, "mid_1");
  assertEquals(cfg.metadata.qb_invoice_id, "3815");
  assertEquals(cfg.level_2_3.order_number, "Q-2026-HKSO-BAL");
  assertEquals(cfg.idempotency_key, `it-payin:${QUOTE_ID}:3815:149901`);
  const sess = calls.find((c) => c.path === "/v1/sessions")!.body as Record<string, any>;
  assertEquals(sess.statements[0].constraints, { merchant: { merchant_id: "mid_1" } });
});

Deno.test("payinSession: already paid / payment in flight / quote changed → a plain message, no session", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 0, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  let j = await (await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json();
  assertEquals(j.payable, false);
  assert(j.message.includes("already paid"));

  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: RfCall[] = [];
  j = await (await call(withQuote({ ...ACTIVE, enabled: true }, {}, [{ shop_owner: OWNER, qb_invoice_id: "3815", status: "processing", qb_payment_id: null }]), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls)).json();
  assertEquals(j.reason, "in_flight");
  assertEquals(calls.length, 0);

  j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { total: 1700 }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json();
  assertEquals(j.reason, "invoice_out_of_date");
});

Deno.test("payinSession: broker quotes never take payment here", async () => {
  const j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { broker_email: "b@x.com" }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json();
  assertEquals(j, { rail: "qb" });
});

Deno.test("payRail: token-gated, answers the rail only", async () => {
  const on = withQuote({ ...ACTIVE, enabled: true });
  const calls: RfCall[] = [];
  const j = await (await call(on, "", { action: "payRail", id: QUOTE_ID, token: "tok" }, undefined, calls)).json();
  assertEquals(j.rail, "processor");
  assertEquals(j.display, { shopName: "Biota Mfg", logoUrl: null, docNumber: "Q-2026-HKSO", customerName: "Tahoe Gift Co" });
  assertEquals(calls.length, 0); // no Rainforest calls on page load (link scanners)
  assertEquals((await call(on, "", { action: "payRail", id: QUOTE_ID, token: "x" })).status, 404);
  assertEquals(await (await call(withQuote(ACTIVE), "", { action: "payRail", id: QUOTE_ID, token: "tok" })).json(), { rail: "qb" });
});

Deno.test("payinSession: tax-held invoice is never charged", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1778.79, Balance: 1778.79, TxnTaxDetail: { TotalTax: 135.79 }, Line: [] };
  const calls: RfCall[] = [];
  const j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { qb_tax_hold: { quotedTax: 0, qbTax: 135.79 } }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls)).json();
  assertEquals(j.reason, "tax_hold");
  assertEquals(calls.length, 0);
});

Deno.test("payinSession: after a refund the same balance gets a NEW config key", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: RfCall[] = [];
  await call(withQuote({ ...ACTIVE, enabled: true }, {}, [{ processor_payin_id: "pyi_old", shop_owner: OWNER, qb_invoice_id: "3815", status: "refunded", qb_payment_id: "501" }]), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls);
  const cfg = calls.find((c) => c.path === "/v1/payin_configs")!.body as Record<string, unknown>;
  assertEquals(cfg.idempotency_key, `it-payin:${QUOTE_ID}:3815:164300:a1`);
});

Deno.test("payinSession: a rejected first config is retried once under a fresh key", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const fake = withQuote({ ...ACTIVE, enabled: true });
  const keys: string[] = [];
  const req = new Request("http://x/rainforest", { method: "POST", body: JSON.stringify({ action: "payinSession", id: QUOTE_ID, token: "tok" }) });
  const r = await handle(req, {
    admin: fake, getUser: () => Promise.resolve(null), env: (k) => ({ RAINFOREST_ENABLED: "true" } as Record<string, string>)[k],
    rf: {
      base: "https://api.sandbox.rainforestpay.com",
      get: () => Promise.resolve({}),
      post: (path, body) => {
        if (path === "/v1/payin_configs") {
          keys.push((body as Record<string, string>).idempotency_key);
          if (keys.length === 1) return Promise.reject(Object.assign(new Error("400 level_2_3 invalid"), { status: 400 }));
          return Promise.resolve({ payin_config_id: "cfg_2" });
        }
        return Promise.resolve({ session_key: "s" });
      },
    },
    qb: { connect: () => Promise.resolve({ token: "t", realmId: "r" }), listAccounts: () => Promise.resolve([]), getInvoice: () => Promise.resolve(liveInvoice) },
  });
  assertEquals((await r.json()).payinConfigId, "cfg_2");
  assertEquals(keys.length, 2);
  assert(keys[1].startsWith(`${keys[0]}:r`));
});

Deno.test("startOnboarding: a second click while the first is creating → 409, one merchant", async () => {
  const fake = db({ merchant_id: null, merchant_creating_at: new Date().toISOString() });
  const calls: RfCall[] = [];
  const r = await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls);
  assertEquals(r.status, 409);
  assertEquals(calls.filter((c) => c.path === "/v1/merchants").length, 0);
});

Deno.test("startOnboarding: a merchant created by a failed earlier attempt is ADOPTED, not duplicated", async () => {
  existingMerchants = [
    { merchant_id: "mid_orphan", merchant_application_id: "app_orphan", status: "PENDING", metadata: { inktracker_shop_owner: OWNER } },
    { merchant_id: "mid_other", merchant_application_id: "app_x", status: "PENDING", metadata: { inktracker_shop_owner: "someone@else.com" } },
  ];
  try {
    const fake = db(null);
    const calls: RfCall[] = [];
    const j = await (await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls)).json();
    assertEquals(j.merchantId, "mid_orphan");
    assertEquals(calls.filter((c) => c.method === "POST" && c.path === "/v1/merchants").length, 0);
    assertEquals(fake.tables.processor_accounts[0].merchant_id, "mid_orphan");
  } finally {
    existingMerchants = [];
  }
});

Deno.test("startOnboarding: Rainforest rejecting the create releases the claim (retry right away)", async () => {
  const fake = db(null);
  const req = new Request("http://x/rainforest", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ action: "startOnboarding" }) });
  let threw = false;
  try {
    await handle(req, {
      admin: fake, getUser: () => Promise.resolve({ id: "own-auth" }), env: (k) => ({ RAINFOREST_ENABLED: "true" } as Record<string, string>)[k],
      rf: { base: "https://api.sandbox.rainforestpay.com", get: () => Promise.resolve({ results: [] }), post: () => Promise.reject(Object.assign(new Error("422"), { status: 422 })) },
      qb: { connect: () => Promise.resolve(null), listAccounts: () => Promise.resolve([]), getInvoice: () => Promise.resolve(null) },
    });
  } catch {
    threw = true;
  }
  assert(threw);
  assertEquals(fake.tables.processor_accounts[0].merchant_creating_at, null);
});
