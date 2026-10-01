// Handler tests for the `stripePayments` edge function: the REAL handler
// against the in-memory fake DB and a recording fake Stripe. Pins who can
// see/change InkTracker payments, that the kill switch wins, that the shop
// OWNER's row is the one acted on, and what reaches Stripe.
// Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../../_shared/testing/fakeSupabase.ts";
import { handle } from "../index.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const OWNER = "owner@shop.com";

function db(account: Record<string, unknown> | null = null) {
  return fakeSupabase({
    profiles: [
      { id: "own-id", auth_id: "own-auth", email: OWNER, role: "shop", shop_owner: null, shop_name: "Biota Mfg", subscription_tier: "shop", subscription_status: "active", zip: "89502", website: "biotamfg.co" },
      { id: "mgr-id", auth_id: "mgr-auth", email: "mgr@shop.com", role: "manager", shop_owner: OWNER },
      { id: "emp-id", auth_id: "emp-auth", email: "emp@shop.com", role: "employee", shop_owner: OWNER },
      { id: "brk-id", auth_id: "brk-auth", email: "broker@x.com", role: "broker", shop_owner: null, assigned_shops: [OWNER] },
    ],
    profile_secrets: [],
    processor_accounts: account ? [{ shop_owner: OWNER, ...account }] : [],
  });
}

const ACTIVE = { merchant_id: "acct_1", merchant_status: "active", enabled: false, qb_bank_account_id: "35", qb_fee_account_id: "88" };
const QUOTE_ID = "11111111-2222-4333-8444-555555555555";

function withQuote(account: Record<string, unknown> | null, quote: Record<string, unknown> = {}, payments: Record<string, unknown>[] = []) {
  const fake = db(account);
  fake.tables.quotes = [{ id: QUOTE_ID, quote_id: "Q-2026-HKSO", shop_owner: OWNER, status: "Sent", total: 1643, tax: 0, qb_invoice_id: "3815", public_token: "tok", customer_name: "Tahoe Gift Co", customer_email: "buyer@tahoegift.com", ...quote }];
  fake.tables.processor_payments = payments;
  return fake;
}

type StripeCall = { method: string; path: string; params?: Any; opts?: Any };

let existingAccounts: Any[] = [];
let accountOnRead: Any = { id: "acct_1", charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } };
let postImpl: ((path: string, params: Any, opts: Any) => Promise<Any>) | null = null;
let oauthAccountId = "acct_existing";
let checkoutNow: Any = null;
let getImpl: ((path: string) => Promise<Any> | undefined) | null = null;

function fakeStripe(calls: StripeCall[] = [], live = true) {
  return {
    live,
    deauthorize: () => Promise.resolve({}),
    oauthToken: (code: string) => {
      calls.push({ method: "OAUTH", path: "/oauth/token", params: { code } });
      return code === "ac_good"
        ? Promise.resolve({ stripe_user_id: oauthAccountId, livemode: live })
        : Promise.reject(Object.assign(new Error("400 invalid_grant"), { status: 400 }));
    },
    get: (path: string, params?: Any, opts?: Any) => {
      calls.push({ method: "GET", path, params, opts });
      if (getImpl) {
        const hit = getImpl(path);
        if (hit !== undefined) return hit;
      }
      if (path === "/v1/accounts") return Promise.resolve({ data: existingAccounts, has_more: false });
      if (path.startsWith("/v1/checkout/sessions/")) return checkoutNow ? Promise.resolve(checkoutNow) : Promise.reject(Object.assign(new Error("404"), { status: 404 }));
      return Promise.resolve(accountOnRead);
    },
    post: (path: string, params?: Any, opts?: Any) => {
      calls.push({ method: "POST", path, params, opts });
      if (postImpl) return postImpl(path, params, opts);
      if (path === "/v1/accounts") return Promise.resolve({ id: "acct_new", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["business_type"] } });
      if (path === "/v1/account_links") return Promise.resolve({ url: "https://connect.stripe.com/setup/s/abc" });
      if (path === "/v1/checkout/sessions") return Promise.resolve({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
      return Promise.resolve({});
    },
  };
}

let liveInvoice: Record<string, unknown> | null = null;
let qbConnected = true;

// Live key by default; test-mode behaviour is exercised explicitly.
function call(fake: unknown, authId: string, body: Record<string, unknown>, env: Record<string, string> = { STRIPE_PAYMENTS_ENABLED: "true", STRIPE_CONNECT_CLIENT_ID: "ca_test123" }, calls: StripeCall[] = [], live = true) {
  const req = new Request("http://x/stripePayments", {
    method: "POST",
    headers: authId ? { Authorization: "Bearer t" } : {},
    body: JSON.stringify(body),
  });
  return handle(req, {
    admin: fake,
    getUser: () => Promise.resolve(authId ? { id: authId } : null),
    env: (k) => env[k],
    stripe: fakeStripe(calls, live),
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
  const j = await (await call(db({ ...ACTIVE, enabled: true }), "own-auth", { action: "status" }, {})).json();
  assertEquals(j.platformEnabled, false);
  assertEquals(j.rail, "qb");
});

Deno.test("status: enabled + active → processor rail; never leaks the Stripe account id; flags test mode", async () => {
  const j = await (await call(db({ ...ACTIVE, enabled: true }), "emp-auth", { action: "status" })).json();
  assertEquals(j.rail, "processor");
  assertEquals(j.stage, "active");
  assertEquals(j.pricing.card, "2.99%");
  assertEquals(j.pricing.ach, "1%");
  assertEquals(j.canToggle, false); // employee
  assertEquals(j.testMode, false);
  assert(!JSON.stringify(j).includes("acct_1"));
  assertEquals((await (await call(db(ACTIVE), "own-auth", { action: "status" }, undefined, [], false)).json()).testMode, true);
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
  assertEquals((await r.json()).rail, "processor");
  assertEquals(fake.writes.length, 1);
  assertEquals(fake.writes[0].table, "processor_accounts");
  assertEquals(fake.writes[0].patch?.enabled, true);
  assertEquals(fake.writes[0].filters.map((f) => `${f.col}=${f.val}`), [`shop_owner=${OWNER}`]);
});

Deno.test("setEnabled: refused while Stripe reviews, without QB accounts, or with the kill switch off", async () => {
  const review = await call(db({ ...ACTIVE, merchant_status: "onboarding", merchant_application_status: "in_review" }), "own-auth", { action: "setEnabled", enabled: true });
  assertEquals(review.status, 400);
  assert((await review.json()).error.includes("reviewing"));
  const noAccts = await call(db({ ...ACTIVE, qb_fee_account_id: null }), "own-auth", { action: "setEnabled", enabled: true });
  assert((await noAccts.json()).error.includes("QuickBooks"));
  const off = await call(db(ACTIVE), "own-auth", { action: "setEnabled", enabled: true }, {});
  assert((await off.json()).error.includes("aren't available"));
});

Deno.test("setEnabled false: always allowed for the owner (back to QuickBooks)", async () => {
  const r = await call(db({ ...ACTIVE, enabled: true, merchant_status: "deactivated" }), "own-auth", { action: "setEnabled", enabled: false }, {});
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

Deno.test("unknown action → 400; the old Rainforest activity screen is gone", async () => {
  assertEquals((await call(db(), "own-auth", { action: "wireMoney" })).status, 400);
  assertEquals((await call(db(ACTIVE), "own-auth", { action: "activitySession" })).status, 400);
});

// ── startOnboarding ─────────────────────────────────────────────────────
Deno.test("startOnboarding: owner on a paid plan → ONE Standard account (prefilled, idempotent), then a Stripe-hosted link", async () => {
  const fake = db(null);
  const calls: StripeCall[] = [];
  const r = await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { url: "https://connect.stripe.com/setup/s/abc" });
  const created = calls.find((c) => c.method === "POST" && c.path === "/v1/accounts")!;
  assertEquals(created.params.type, "standard");
  assertEquals(created.params.email, OWNER);
  assertEquals(created.params.business_profile.name, "Biota Mfg");
  assertEquals(created.params.metadata, { inktracker_shop_owner: OWNER });
  assert(created.opts.idempotencyKey.startsWith(`it-acct:${OWNER}:first:`));
  const link = calls.find((c) => c.path === "/v1/account_links")!;
  assertEquals(link.params.account, "acct_new");
  assertEquals(link.params.return_url, "https://www.inktracker.app/Account?payments=return#payments");
  assertEquals(fake.tables.processor_accounts[0].merchant_id, "acct_new");
  assertEquals(fake.tables.processor_accounts[0].merchant_status, "pending");

  const again: StripeCall[] = [];
  await call(fake, "own-auth", { action: "startOnboarding" }, undefined, again);
  assertEquals(again.filter((c) => c.method === "POST" && c.path === "/v1/accounts").length, 0); // resumed, not duplicated
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

Deno.test("startOnboarding: a second click while the first is creating → 409, one account", async () => {
  const calls: StripeCall[] = [];
  const r = await call(db({ merchant_id: null, merchant_creating_at: new Date().toISOString() }), "own-auth", { action: "startOnboarding" }, undefined, calls);
  assertEquals(r.status, 409);
  assertEquals(calls.filter((c) => c.path === "/v1/accounts").length, 0);
});

Deno.test("startOnboarding: an account created by a failed earlier attempt is ADOPTED, not duplicated", async () => {
  existingAccounts = [
    { id: "acct_other", metadata: { inktracker_shop_owner: "someone@else.com" } },
    { id: "acct_orphan", metadata: { inktracker_shop_owner: OWNER }, details_submitted: false, requirements: { currently_due: [] } },
  ];
  try {
    const fake = db(null);
    const calls: StripeCall[] = [];
    await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls);
    assertEquals(calls.filter((c) => c.method === "POST" && c.path === "/v1/accounts").length, 0);
    assertEquals(fake.tables.processor_accounts[0].merchant_id, "acct_orphan");
  } finally {
    existingAccounts = [];
  }
});

Deno.test("startOnboarding: Stripe rejecting the create releases the claim (retry right away)", async () => {
  const fake = db(null);
  postImpl = () => Promise.reject(Object.assign(new Error("400 Connect not enabled"), { status: 400 }));
  let threw = false;
  try {
    await call(fake, "own-auth", { action: "startOnboarding" });
  } catch {
    threw = true;
  } finally {
    postImpl = null;
  }
  assert(threw);
  assertEquals(fake.tables.processor_accounts[0].merchant_creating_at, null);
});

Deno.test("startOnboarding: a closed (rejected / disconnected) account can be replaced with a new one", async () => {
  const fake = db({ merchant_id: "acct_old", merchant_status: "canceled", merchant_application_status: "declined", enabled: true });
  const st = await (await call(fake, "own-auth", { action: "status" })).json();
  assertEquals(st.stage, "declined");
  assertEquals(st.canStartOver, true);
  const calls: StripeCall[] = [];
  await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls);
  const created = calls.filter((c) => c.method === "POST" && c.path === "/v1/accounts");
  assertEquals(created.length, 1);
  assert(created[0].opts.idempotencyKey.startsWith(`it-acct:${OWNER}:new:`));
  assertEquals(fake.tables.processor_accounts[0].merchant_id, "acct_new");
  assertEquals(fake.tables.processor_accounts[0].enabled, false); // must re-enable after approval
});

Deno.test("refreshStatus: reads the account from Stripe; approval stamps onboarded_at", async () => {
  const fake = db({ merchant_id: "acct_1", merchant_status: "pending", merchant_application_status: "in_progress" });
  accountOnRead = { id: "acct_1", charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements: { currently_due: [], disabled_reason: "requirements.pending_verification" } };
  let j = await (await call(fake, "own-auth", { action: "refreshStatus" })).json();
  assertEquals(j.stage, "in_review");
  accountOnRead = { id: "acct_1", charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } };
  j = await (await call(fake, "own-auth", { action: "refreshStatus" })).json();
  assertEquals(j.stage, "active");
  assert(fake.tables.processor_accounts[0].onboarded_at);
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
  assertEquals(await (await call(withQuote(ACTIVE), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json(), { rail: "qb" });
  assertEquals(await (await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, {})).json(), { rail: "qb" });
});

Deno.test("payinSession: a Checkout ON the shop's account for the LIVE QuickBooks balance, with InkTracker's fee", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1499.01, TxnTaxDetail: { TotalTax: 0 }, CustomerRef: { value: "61" }, Line: [] };
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "card" }, undefined, calls)).json();
  assertEquals(j.payable, true);
  assertEquals(j.method, "card");
  assertEquals(j.amountCents, 149901);
  assertEquals(j.kind, "balance");
  assertEquals(j.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_1");
  const cs = calls.find((c) => c.path === "/v1/checkout/sessions")!;
  assertEquals(cs.opts.account, "acct_1"); // direct charge on the shop's account
  assert(cs.opts.idempotencyKey.startsWith(`it-checkout:${QUOTE_ID}:3815:149901:card:w`));
  assertEquals(cs.params.line_items[0].price_data.unit_amount, 149901);
  assertEquals(cs.params.payment_intent_data.metadata.qb_invoice_id, "3815");
  // 2.99% of $1,499.01 = $44.82; Stripe 2.9% + 30¢ = $43.77 → InkTracker $1.05.
  assertEquals(cs.params.payment_intent_data.application_fee_amount, 105);
  assertEquals(cs.params.customer_email, "buyer@tahoegift.com");
  assertEquals(cs.params.success_url, `https://www.inktracker.app/QuotePayment?id=${QUOTE_ID}&token=tok&paid=card&session_id={CHECKOUT_SESSION_ID}`);
});

Deno.test("payinSession: bank → us_bank_account and the bank fee; a shop without ACH gets a plain message", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1297, Balance: 1297, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: StripeCall[] = [];
  await call(withQuote({ ...ACTIVE, enabled: true }, { total: 1297 }), "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "ach" }, undefined, calls);
  const cs = calls.find((c) => c.path === "/v1/checkout/sessions")!;
  assertEquals(cs.params.payment_method_types, ["us_bank_account"]);
  assertEquals(cs.params.payment_intent_data.application_fee_amount, 647);

  postImpl = () => Promise.reject(Object.assign(new Error("400 The payment method type us_bank_account is invalid"), { status: 400 }));
  try {
    const j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { total: 1297 }), "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "ach" })).json();
    assertEquals(j.payable, false);
    assertEquals(j.reason, "no_bank");
    assert(j.message.includes("pay by card"));
  } finally {
    postImpl = null;
  }
});

Deno.test("payinSession: already paid / payment in flight / quote changed → a plain message, no checkout", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 0, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  let j = await (await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json();
  assertEquals(j.payable, false);
  assert(j.message.includes("already paid"));

  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: StripeCall[] = [];
  j = await (await call(withQuote({ ...ACTIVE, enabled: true }, {}, [{ shop_owner: OWNER, qb_invoice_id: "3815", status: "processing", qb_payment_id: null }]), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls)).json();
  assertEquals(j.reason, "in_flight");
  assertEquals(calls.length, 0);

  j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { total: 1700 }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json();
  assertEquals(j.reason, "invoice_out_of_date");
});

Deno.test("payinSession: broker quotes never take payment here; tax-held invoices are never charged", async () => {
  assertEquals(await (await call(withQuote({ ...ACTIVE, enabled: true }, { broker_email: "b@x.com" }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json(), { rail: "qb" });
  liveInvoice = { Id: "3815", TotalAmt: 1778.79, Balance: 1778.79, TxnTaxDetail: { TotalTax: 135.79 }, Line: [] };
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { qb_tax_hold: { quotedTax: 0, qbTax: 135.79 } }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls)).json();
  assertEquals(j.reason, "tax_hold");
  assertEquals(calls.length, 0);
});

Deno.test("payRail: token-gated, answers the rail only (no Stripe calls on page load)", async () => {
  const on = withQuote({ ...ACTIVE, enabled: true });
  const calls: StripeCall[] = [];
  const j = await (await call(on, "", { action: "payRail", id: QUOTE_ID, token: "tok" }, undefined, calls)).json();
  assertEquals(j.rail, "processor");
  assertEquals(j.display, { shopName: "Biota Mfg", logoUrl: null, docNumber: "Q-2026-HKSO", customerName: "Tahoe Gift Co" });
  assertEquals(calls.length, 0);
  assertEquals((await call(on, "", { action: "payRail", id: QUOTE_ID, token: "x" })).status, 404);
  assertEquals(await (await call(withQuote(ACTIVE), "", { action: "payRail", id: QUOTE_ID, token: "tok" })).json(), { rail: "qb" });
});

Deno.test("payinSession: after a refund the same balance gets a NEW checkout key", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: StripeCall[] = [];
  await call(withQuote({ ...ACTIVE, enabled: true }, {}, [{ processor_payin_id: "pi_old", shop_owner: OWNER, qb_invoice_id: "3815", status: "refunded", qb_payment_id: "501" }]), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls);
  assert(calls.find((c) => c.path === "/v1/checkout/sessions")!.opts.idempotencyKey.endsWith(":a1"));
});

Deno.test("payinSession: a reused-key rejection is retried once under a fresh key", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const keys: string[] = [];
  postImpl = (_p, _b, opts) => {
    keys.push(opts.idempotencyKey);
    return keys.length === 1
      ? Promise.reject(Object.assign(new Error("400 Keys for idempotent requests can only be used with the same parameters"), { status: 400 }))
      : Promise.resolve({ id: "cs_2", url: "https://checkout.stripe.com/c/pay/cs_2" });
  };
  try {
    const j = await (await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" })).json();
    assertEquals(j.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_2");
    assertEquals(keys.length, 2);
    assert(keys[1].startsWith(`${keys[0]}:r`));
  } finally {
    postImpl = null;
  }
});

Deno.test("payinSession: a hammered pay link reuses the recent checkout — same method only", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, CustomerRef: { value: "61" }, Line: [] };
  const fake = withQuote({ ...ACTIVE, enabled: true });
  const calls: StripeCall[] = [];
  const first = await (await call(fake, "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "card" }, undefined, calls)).json();
  for (let i = 0; i < 5; i++) {
    const again = await (await call(fake, "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "card" }, undefined, calls)).json();
    assertEquals(again.checkoutUrl, first.checkoutUrl);
  }
  assertEquals(calls.filter((c) => c.path === "/v1/checkout/sessions").length, 1);
  await call(fake, "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "ach" }, undefined, calls);
  assertEquals(calls.filter((c) => c.path === "/v1/checkout/sessions").length, 2);
});

// ── Test mode, live switch-over, existing Stripe accounts ───────────────
Deno.test("test mode: only TEST/DEMO documents use Stripe; a real customer's quote stays on QuickBooks", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const real = withQuote({ ...ACTIVE, enabled: true, stripe_livemode: false });
  const calls: StripeCall[] = [];
  assertEquals(await (await call(real, "", { action: "payRail", id: QUOTE_ID, token: "tok" }, undefined, calls, false)).json(), { rail: "qb" });
  assertEquals(await (await call(real, "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls, false)).json(), { rail: "qb" });
  assertEquals(calls.length, 0);
  const test = withQuote({ ...ACTIVE, enabled: true, stripe_livemode: false }, { customer_name: "TEST Tahoe Gift Co" });
  const j = await (await call(test, "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls, false)).json();
  assertEquals(j.payable, true);
});

Deno.test("going live: a test-mode account reads as not set up (no false 'disconnected'), and sign-up makes a live one", async () => {
  const fake = db({ ...ACTIVE, enabled: true, stripe_livemode: false });
  const st = await (await call(fake, "own-auth", { action: "status" })).json();
  assertEquals(st.stage, "not_started");
  assertEquals(st.rail, "qb");
  const calls: StripeCall[] = [];
  const r = await call(fake, "own-auth", { action: "startOnboarding" }, undefined, calls);
  assertEquals(r.status, 200);
  assertEquals(calls.filter((c) => c.method === "POST" && c.path === "/v1/accounts").length, 1);
  assertEquals(fake.tables.processor_accounts[0].merchant_id, "acct_new");
  assertEquals(fake.tables.processor_accounts[0].stripe_livemode, true);
  assertEquals(fake.tables.processor_accounts[0].enabled, false);
});

Deno.test("connect an existing Stripe account: one-time state, linked to THIS shop, not switched on yet", async () => {
  const fake = db(null);
  const env = { STRIPE_PAYMENTS_ENABLED: "true", STRIPE_CONNECT_CLIENT_ID: "ca_test123" };
  assertEquals((await call(fake, "mgr-auth", { action: "connectExisting" }, env)).status, 403);
  const start = await (await call(fake, "own-auth", { action: "connectExisting" }, env)).json();
  const url = new URL(start.url);
  assertEquals(url.origin + url.pathname, "https://connect.stripe.com/oauth/authorize");
  assertEquals(url.searchParams.get("client_id"), "ca_test123");
  assertEquals(url.searchParams.get("redirect_uri"), "https://www.inktracker.app/Account?payments=oauth");
  const state = url.searchParams.get("state")!;
  assertEquals(fake.tables.processor_accounts[0].oauth_state, state);

  // Wrong state → refused, nothing linked.
  const bad = await call(fake, "own-auth", { action: "finishConnect", code: "ac_good", state: "forged" }, env);
  assertEquals(bad.status, 400);
  assertEquals(fake.tables.processor_accounts[0].merchant_id ?? null, null);

  const ok = await (await call(fake, "own-auth", { action: "finishConnect", code: "ac_good", state }, env)).json();
  assertEquals(ok.stage, "active");
  assertEquals(fake.tables.processor_accounts[0].merchant_id, "acct_existing");
  assertEquals(fake.tables.processor_accounts[0].enabled, false);
  assertEquals(fake.tables.processor_accounts[0].oauth_state, null); // used up
  // Replaying the same redirect does nothing.
  assertEquals((await call(fake, "own-auth", { action: "finishConnect", code: "ac_good", state }, env)).status, 400);
});

Deno.test("connect existing: expired state, a Stripe account another shop uses, and no client id are refused", async () => {
  const env = { STRIPE_PAYMENTS_ENABLED: "true", STRIPE_CONNECT_CLIENT_ID: "ca_test123" };
  const stale = db({ merchant_id: null, oauth_state: "s1", oauth_state_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() });
  assertEquals((await call(stale, "own-auth", { action: "finishConnect", code: "ac_good", state: "s1" }, env)).status, 400);

  const taken = db({ merchant_id: null, oauth_state: "s2", oauth_state_at: new Date().toISOString() });
  taken.tables.processor_accounts.push({ shop_owner: "other@shop.com", merchant_id: "acct_existing" });
  const r = await call(taken, "own-auth", { action: "finishConnect", code: "ac_good", state: "s2" }, env);
  assertEquals(r.status, 409);
  assert((await r.json()).error.includes("another InkTracker shop"));

  assertEquals((await call(db(null), "own-auth", { action: "connectExisting" }, { STRIPE_PAYMENTS_ENABLED: "true" })).status, 400);
  const st = await (await call(db(null), "own-auth", { action: "status" }, env)).json();
  assertEquals(st.canConnectExisting, true);
  assertEquals((await (await call(db(null), "own-auth", { action: "status" }, { STRIPE_PAYMENTS_ENABLED: "true" })).json()).canConnectExisting, false);
  assertEquals((await (await call(db(ACTIVE), "own-auth", { action: "status" }, env)).json()).canConnectExisting, false);
});

Deno.test("checkout asks Stripe to email the customer a receipt", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 1643, Balance: 1643, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: StripeCall[] = [];
  await call(withQuote({ ...ACTIVE, enabled: true }), "", { action: "payinSession", id: QUOTE_ID, token: "tok" }, undefined, calls);
  assertEquals(calls.find((c) => c.path === "/v1/checkout/sessions")!.params.payment_intent_data.receipt_email, "buyer@tahoegift.com");
});

Deno.test("paid return: confirmed only for a COMPLETE checkout of THIS document, on the shop's account", async () => {
  const fake = withQuote({ ...ACTIVE, enabled: true });
  const ask = async (sessionId: string) => (await (await call(fake, "", { action: "paidStatus", id: QUOTE_ID, token: "tok", sessionId })).json());
  checkoutNow = { id: "cs_live_abc", client_reference_id: QUOTE_ID, status: "complete", payment_status: "paid" };
  try {
    assertEquals(await ask("cs_live_abc"), { confirmed: true, state: "paid" });
    checkoutNow = { ...checkoutNow, payment_status: "unpaid" }; // bank, clearing
    assertEquals(await ask("cs_live_abc"), { confirmed: true, state: "processing" });
    checkoutNow = { ...checkoutNow, client_reference_id: "someone-elses-quote" };
    assertEquals(await ask("cs_live_abc"), { confirmed: false });
    checkoutNow = { id: "cs_live_abc", client_reference_id: QUOTE_ID, status: "open", payment_status: "unpaid" };
    assertEquals(await ask("cs_live_abc"), { confirmed: false });
    assertEquals(await ask(""), { confirmed: false }); // a typed ?paid=card with no session
    assertEquals(await ask("{CHECKOUT_SESSION_ID}"), { confirmed: false });
    assertEquals((await call(fake, "", { action: "paidStatus", id: QUOTE_ID, token: "nope", sessionId: "cs_live_abc" })).status, 404);
  } finally {
    checkoutNow = null;
  }
});

Deno.test("test mode: TEST/DEMO in the JOB TITLE counts on the pay page too (same answer as qbSync)", async () => {
  const fake = withQuote({ ...ACTIVE, enabled: true, stripe_livemode: false }, { job_title: "DEMO hoodies" });
  const j = await (await call(fake, "", { action: "payRail", id: QUOTE_ID, token: "tok" }, undefined, [], false)).json();
  assertEquals(j.rail, "processor");
});

Deno.test("sign-up needs the platform client id (so the account can always be disconnected later)", async () => {
  const calls: StripeCall[] = [];
  const r = await call(db(null), "own-auth", { action: "startOnboarding" }, { STRIPE_PAYMENTS_ENABLED: "true" }, calls);
  assertEquals(r.status, 400);
  assertEquals(calls.length, 0);
});

// ── Fees the customer pays ──────────────────────────────────────────────
const FEES_ON = { ...ACTIVE, enabled: true, customer_fees_enabled: true, bank_fee_pct: 1 };
const PK_ENV = { STRIPE_PAYMENTS_ENABLED: "true", STRIPE_CONNECT_CLIENT_ID: "ca_test123", STRIPE_CONNECT_PUBLISHABLE_KEY: "pk_live_abc" };

Deno.test("customer fees: owner only; turning on needs the owner's okay; bank fee 0–1%", async () => {
  const fake = db({ ...ACTIVE, enabled: true });
  assertEquals((await call(fake, "mgr-auth", { action: "setCustomerFees", enabled: true, acknowledged: true })).status, 403);
  assertEquals((await call(fake, "own-auth", { action: "setCustomerFees", enabled: true })).status, 400);
  assertEquals((await call(fake, "own-auth", { action: "setCustomerFees", enabled: true, acknowledged: true, bankFeePct: 2 })).status, 400);
  const j = await (await call(fake, "own-auth", { action: "setCustomerFees", enabled: true, acknowledged: true, bankFeePct: 0.5 }, PK_ENV)).json();
  assertEquals(j.customerFees.enabled, true);
  assertEquals(j.customerFees.bankPct, 0.5);
  assertEquals(j.cardSurchargeReady, true);
  const row = fake.tables.processor_accounts[0];
  assertEquals([row.customer_fees_enabled, row.bank_fee_pct], [true, 0.5]);
  assert(row.customer_fees_ack_at);
  // Without the publishable key the card form can't run: not ready.
  assertEquals((await (await call(fake, "own-auth", { action: "status" })).json()).cardSurchargeReady, false);
  // Turning off needs no okay.
  assertEquals((await (await call(fake, "own-auth", { action: "setCustomerFees", enabled: false })).json()).customerFees.enabled, false);
});

Deno.test("customer fees: the pay page gets the fee amounts and the card form without calling Stripe or QuickBooks", async () => {
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote(FEES_ON, { qb_total: 568.72, total: 568.72 }), "", { action: "payRail", id: QUOTE_ID, token: "tok" }, PK_ENV, calls)).json();
  assertEquals(j.pricing.invoiceCents, 56872);
  assertEquals(j.pricing.creditFeeCents, 1700);
  assertEquals(j.pricing.bankFeeCents, 569);
  assertEquals(j.pricing.cardForm, { publishableKey: "pk_live_abc", accountId: "acct_1" });
  assert(j.pricing.note.includes("2.99%"));
  assertEquals(calls.length, 0);
  // A test-mode key with a live-mode publishable key → no card form, no card fee.
  const t = await (await call(withQuote(FEES_ON, { qb_total: 568.72, customer_name: "TEST Co" }), "", { action: "payRail", id: QUOTE_ID, token: "tok" }, PK_ENV, [], false)).json();
  assertEquals(t.pricing.cardForm ?? null, null);
  // Fees off → nothing extra.
  const off = await (await call(withQuote({ ...ACTIVE, enabled: true }, { qb_total: 568.72 }), "", { action: "payRail", id: QUOTE_ID, token: "tok" }, PK_ENV)).json();
  assertEquals([off.pricing.creditFeeCents, off.pricing.bankFeeCents, off.pricing.cardForm], [0, 0, null]);
});

Deno.test("customer fees: bank checkout adds the fee as its own line on the LIVE balance", async () => {
  liveInvoice = { Id: "3815", TotalAmt: 568.72, Balance: 568.72, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  const calls: StripeCall[] = [];
  const bank = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "payinSession", id: QUOTE_ID, token: "tok", method: "ach" }, PK_ENV, calls)).json();
  assertEquals([bank.invoiceCents, bank.feeCents, bank.amountCents], [56872, 569, 57441]);
  const cs = calls.find((c) => c.path === "/v1/checkout/sessions")!;
  assertEquals(cs.params.line_items.map((l: Any) => l.price_data.unit_amount), [56872, 569]);
  assertEquals(cs.params.payment_intent_data.metadata.customer_fee_cents, "569");
});

function cardSetup(funding: string, piResult: Any = { id: "pi_9", status: "succeeded", amount: 58572 }) {
  liveInvoice = { Id: "3815", TotalAmt: 568.72, Balance: 568.72, TxnTaxDetail: { TotalTax: 0 }, Line: [] };
  getImpl = (path) => path.startsWith("/v1/confirmation_tokens/")
    ? Promise.resolve({ id: "ctoken_1", payment_method_preview: { type: "card", card: { funding, brand: "visa", last4: "4242" } } })
    : undefined;
  postImpl = (path) => path === "/v1/payment_intents"
    ? (typeof piResult === "function" ? piResult() : Promise.resolve(piResult))
    : Promise.resolve({});
}
const cardReq = (extra: Record<string, unknown> = {}) => ({ id: QUOTE_ID, token: "tok", confirmationToken: "ctoken_1", ...extra });

Deno.test("card: a credit card is quoted the 2.99% surcharge BEFORE anything is charged", async () => {
  cardSetup("credit");
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardQuote", ...cardReq() }, PK_ENV, calls)).json();
  assertEquals([j.invoiceCents, j.surchargeCents, j.totalCents, j.funding], [56872, 1700, 58572, "credit"]);
  assertEquals(calls.filter((c) => c.method === "POST").length, 0);
  assertEquals(calls.find((c) => c.path.startsWith("/v1/confirmation_tokens/"))!.opts.account, "acct_1");
  getImpl = null; postImpl = null;
});

Deno.test("card: debit pays no surcharge", async () => {
  cardSetup("debit");
  const j = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardQuote", ...cardReq() }, PK_ENV)).json();
  assertEquals([j.surchargeCents, j.totalCents], [0, 56872]);
  getImpl = null; postImpl = null;
});

Deno.test("card: pays the agreed total as a Stripe surcharge on the shop's account", async () => {
  cardSetup("credit");
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardPay", ...cardReq({ expectTotalCents: 58572 }) }, PK_ENV, calls)).json();
  assertEquals([j.state, j.amountCents, j.surchargeCents], ["paid", 58572, 1700]);
  const pi = calls.find((c) => c.path === "/v1/payment_intents")!;
  assertEquals(pi.opts.account, "acct_1");
  assertEquals(pi.opts.version, "2026-03-25.preview");
  assertEquals(pi.params.amount, 58572);
  assertEquals(pi.params.amount_details, { surcharge: { amount: 1700, enforce_validation: "enabled" } });
  assertEquals(pi.params.metadata.customer_fee_cents, "1700");
  getImpl = null; postImpl = null;
});

Deno.test("card: if the amount changed since the customer looked, nothing is charged", async () => {
  cardSetup("credit");
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardPay", ...cardReq({ expectTotalCents: 56872 }) }, PK_ENV, calls)).json();
  assertEquals([j.changed, j.totalCents], [true, 58572]);
  assertEquals(calls.filter((c) => c.method === "POST").length, 0);
  getImpl = null; postImpl = null;
});

Deno.test("card: declined → the bank's words, no crash; 3-D Secure → client secret for the page", async () => {
  cardSetup("credit", () => Promise.reject(Object.assign(new Error("Stripe POST /v1/payment_intents → 402: Your card was declined."), { status: 402 })));
  const d = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardPay", ...cardReq({ expectTotalCents: 58572 }) }, PK_ENV)).json();
  assertEquals([d.declined, d.message], [true, "Your card was declined."]);
  cardSetup("credit", { id: "pi_3ds", status: "requires_action", client_secret: "pi_3ds_secret_x", amount: 58572 });
  const a = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardPay", ...cardReq({ expectTotalCents: 58572 }) }, PK_ENV)).json();
  assertEquals([a.requiresAction, a.clientSecret], [true, "pi_3ds_secret_x"]);
  getImpl = null; postImpl = null;
});

Deno.test("card: Stripe refuses the surcharge → charged WITHOUT it (never more than agreed)", async () => {
  let n = 0;
  cardSetup("credit", () => (n++ === 0
    ? Promise.reject(Object.assign(new Error("Stripe POST /v1/payment_intents → 400: surcharge is not available"), { status: 400 }))
    : Promise.resolve({ id: "pi_2", status: "succeeded", amount: 56872 })));
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote(FEES_ON, { total: 568.72 }), "", { action: "cardPay", ...cardReq({ expectTotalCents: 58572 }) }, PK_ENV, calls)).json();
  assertEquals([j.state, j.amountCents, j.surchargeCents], ["paid", 56872, 0]);
  const second = calls.filter((c) => c.path === "/v1/payment_intents")[1];
  assertEquals(second.params.amount, 56872);
  assertEquals(second.params.amount_details, undefined);
  getImpl = null; postImpl = null;
});

Deno.test("card: no card form for this shop (fees off) → refused, nothing charged", async () => {
  cardSetup("credit");
  const calls: StripeCall[] = [];
  const j = await (await call(withQuote({ ...ACTIVE, enabled: true }, { total: 568.72 }), "", { action: "cardPay", ...cardReq({ expectTotalCents: 56872 }) }, PK_ENV, calls)).json();
  assertEquals(j.reason, "card_form_off");
  assertEquals(calls.length, 0);
  getImpl = null; postImpl = null;
});

Deno.test("paidStatus: a card PaymentIntent must belong to THIS document", async () => {
  getImpl = (path) => path === "/v1/payment_intents/pi_9"
    ? Promise.resolve({ id: "pi_9", status: "succeeded", metadata: { inktracker_quote_id: QUOTE_ID } })
    : path === "/v1/payment_intents/pi_other"
      ? Promise.resolve({ id: "pi_other", status: "succeeded", metadata: { inktracker_quote_id: "someone-else" } })
      : undefined;
  const ok = await (await call(withQuote(FEES_ON), "", { action: "paidStatus", id: QUOTE_ID, token: "tok", paymentIntentId: "pi_9" })).json();
  assertEquals([ok.confirmed, ok.state], [true, "paid"]);
  const other = await (await call(withQuote(FEES_ON), "", { action: "paidStatus", id: QUOTE_ID, token: "tok", paymentIntentId: "pi_other" })).json();
  assertEquals(other.confirmed, false);
  getImpl = null;
});
