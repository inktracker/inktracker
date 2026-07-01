// SUBSCRIPTION WRITE GATE — an expired/incomplete account cannot create
// quotes or orders; an active one can. Asserts the has_active_subscription()
// RLS WITH CHECK directly, signed in as the owner (real anon-key client).
//
// Guards BILL-01/BILL-02: the gate is enforced in RLS, so a frontend bypass
// can't let a lapsed shop keep writing.
import { test, expect } from "@playwright/test";
import { admin, authedClient } from "./_helpers/supabaseClients.js";
import { createTestShop, deleteTestShop } from "./_helpers/testShop.js";

let shop;
test.beforeAll(async () => { shop = await createTestShop(); });
test.afterAll(async () => { await deleteTestShop(shop); });

async function setTier(tier, status = "active") {
  await admin.from("profiles")
    .update({ subscription_tier: tier, subscription_status: status, trial_ends_at: null })
    .eq("email", shop.email);
}

async function tryCreateQuote(client) {
  return client.from("quotes").insert({
    shop_owner: shop.email,
    quote_id: `Q-GATE-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: "Gate Test",
    status: "Draft",
    line_items: [], subtotal: 0, total: 0,
  }).select("id");
}

test("an INCOMPLETE account cannot create a quote (RLS denies)", async () => {
  await setTier("incomplete", "incomplete");
  const c = await authedClient(shop.email, shop.password);
  const res = await tryCreateQuote(c);
  // RLS WITH CHECK violation surfaces as an error / no inserted row.
  expect(Boolean(res.error) || !(res.data && res.data.length)).toBe(true);
});

test("an EXPIRED account cannot create a quote (RLS denies)", async () => {
  await setTier("expired", "canceled");
  const c = await authedClient(shop.email, shop.password);
  const res = await tryCreateQuote(c);
  expect(Boolean(res.error) || !(res.data && res.data.length)).toBe(true);
});

test("an ACTIVE account CAN create a quote", async () => {
  await setTier("shop", "active");
  const c = await authedClient(shop.email, shop.password);
  const res = await tryCreateQuote(c);
  expect(res.error, res.error?.message).toBeNull();
  expect(res.data.length).toBe(1);
  // cleanup the inserted quote
  if (res.data?.[0]?.id) await admin.from("quotes").delete().eq("id", res.data[0].id);
});
