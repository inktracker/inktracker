// Test-shop fixtures for money-path / role e2e specs.
//
// createTestUser makes a bare auth user; the shop pages need a real
// tenant: an owner profile (role=shop) with a shop_name, a shops row
// with pricing_config, and at least one customer + quote so list views
// have something to render. This builds that, and tears it all down by
// shop_owner email (quotes/customers/orders are keyed by email, not
// FK-cascaded to the auth user).
//
// Runs against the project's Supabase via the service role — same
// pattern as testUser.js. Spec files only; never the browser.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("e2e testShop needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.");
}
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "E2e!testpw-123456";

async function makeOwnerUser(emailPrefix) {
  const email = `${emailPrefix}+${randomUUID()}@inktracker.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return { email, id: data.user.id };
}

// Create a fully-set-up owner shop with one customer + one saved quote.
// Returns { email, password, authId, shopName, customerId, quoteId }.
export async function createTestShop() {
  const { email, id: authId } = await makeOwnerUser("pw-owner");
  const shopName = `E2E Shop ${randomUUID().slice(0, 8)}`;

  // Owner profile: handle_new_user may have created a row; upsert role + shop_name.
  await admin.from("profiles").update({ role: "shop", shop_name: shopName, full_name: "E2E Owner" }).eq("auth_id", authId);

  // shops row (owner_email keyed) with a minimal valid pricing_config.
  await admin.from("shops").upsert({ owner_email: email, shop_name: shopName, pricing_config: {} }, { onConflict: "owner_email" });

  // A customer so the Customers list isn't empty.
  const { data: cust } = await admin.from("customers")
    .insert({ shop_owner: email, name: "E2E Contact", company: "E2E Customer Co", email: "e2e-cust@inktracker.test" })
    .select("id").single();

  // A saved quote so the Quotes list renders.
  const { data: quote } = await admin.from("quotes")
    .insert({
      shop_owner: email, quote_id: `Q-E2E-${randomUUID().slice(0, 6)}`,
      customer_id: cust?.id, customer_name: "E2E Contact", status: "Draft",
      line_items: [], subtotal: 0, total: 0,
    })
    .select("id").single();

  return { email, password: PASSWORD, authId, shopName, customerId: cust?.id, quoteId: quote?.id };
}

// Add a manager to an existing shop. Returns { email, password, authId }.
export async function addTestManager(ownerEmail, permissions = null) {
  const { email, id: authId } = await makeOwnerUser("pw-mgr");
  const { data: owner } = await admin.from("profiles").select("shop_name").eq("email", ownerEmail).maybeSingle();
  await admin.from("profiles").update({
    role: "manager",
    shop_owner: ownerEmail,
    assigned_shops: [ownerEmail],
    shop_name: owner?.shop_name || null,
    full_name: "E2E Manager",
    manager_permissions: permissions,
  }).eq("auth_id", authId);
  return { email, password: PASSWORD, authId };
}

// Tear down a shop and everything keyed to it.
export async function deleteTestShop(shop) {
  if (!shop) return;
  const email = shop.email;
  try {
    await admin.from("quotes").delete().eq("shop_owner", email);
    await admin.from("orders").delete().eq("shop_owner", email);
    await admin.from("customers").delete().eq("shop_owner", email);
    await admin.from("shops").delete().eq("owner_email", email);
    await admin.auth.admin.deleteUser(shop.authId);
  } catch { /* best effort teardown */ }
}

export async function deleteTestUserById(authId) {
  if (!authId) return;
  await admin.auth.admin.deleteUser(authId).catch(() => {});
}
