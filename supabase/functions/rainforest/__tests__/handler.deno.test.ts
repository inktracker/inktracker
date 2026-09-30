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
      { id: "own-id", auth_id: "own-auth", email: OWNER, role: "shop", shop_owner: null },
      { id: "mgr-id", auth_id: "mgr-auth", email: "mgr@shop.com", role: "manager", shop_owner: OWNER },
      { id: "emp-id", auth_id: "emp-auth", email: "emp@shop.com", role: "employee", shop_owner: OWNER },
      { id: "brk-id", auth_id: "brk-auth", email: "broker@x.com", role: "broker", shop_owner: null, assigned_shops: [OWNER] },
    ],
    profile_secrets: [],
    processor_accounts: account ? [{ shop_owner: OWNER, ...account }] : [],
  });
}

const ACTIVE = { merchant_id: "mid_1", merchant_status: "active", enabled: false, qb_bank_account_id: "35", qb_fee_account_id: "88" };

function call(fake: unknown, authId: string, body: Record<string, unknown>, env: Record<string, string> = { RAINFOREST_ENABLED: "true" }) {
  const req = new Request("http://x/rainforest", {
    method: "POST",
    headers: { Authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
  return handle(req, {
    admin: fake,
    getUser: () => Promise.resolve(authId ? { id: authId } : null),
    env: (k) => env[k],
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
  const r = await call(db(), "mgr-auth", { action: "saveQbAccounts", bankAccountId: "35", feeAccountId: "88" });
  assertEquals(r.status, 400);
  assert((await r.json()).error.includes("Connect QuickBooks"));
});

Deno.test("unknown action → 400", async () => {
  assertEquals((await call(db(), "own-auth", { action: "wireMoney" })).status, 400);
});
