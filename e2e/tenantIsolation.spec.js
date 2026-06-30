// TENANT ISOLATION — the highest-value regression guard.
//
// Two shops (A and B). Signed in AS shop A (real anon-key client under A's RLS
// context), assert A can read its OWN rows but NOT shop B's quotes, orders,
// customers, or invoices — and cannot sign shop B's artwork object. Run against
// the real Supabase project so this exercises the actual RLS + storage policies.
//
// Guards: the multi-tenant RLS lockdown AND the artwork tenant-scope policy
// (20260820). The artwork assertion fails (red) if the broad
// `authenticated_read_artwork` policy is ever restored.
import { test, expect } from "@playwright/test";
import { admin, authedClient } from "./_helpers/supabaseClients.js";
import { createTestShop, deleteTestShop } from "./_helpers/testShop.js";

let shopA, shopB;
let bArtworkPath;

test.beforeAll(async () => {
  [shopA, shopB] = await Promise.all([createTestShop(), createTestShop()]);

  // Seed shop B with an order, an invoice, and an artwork object referenced by
  // the order (so the policy has something to scope). Service role bypasses RLS.
  bArtworkPath = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const px = Uint8Array.from([137, 80, 78, 71]); // 4 bytes, enough to exist
  await admin.storage.from("artwork").upload(bArtworkPath, px, { contentType: "image/png", upsert: true });
  const fileUrl = `${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL}/storage/v1/object/public/artwork/${bArtworkPath}`;

  await admin.from("orders").insert({
    shop_owner: shopB.email,
    order_id: `ORD-E2E-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: "B Customer",
    status: "Art Approval",
    total: 100, subtotal: 100, tax: 0,
    selected_artwork: [{ id: bArtworkPath, name: "b.png", path: bArtworkPath, url: fileUrl }],
  });
  await admin.from("invoices").insert({
    shop_owner: shopB.email,
    invoice_id: `INV-E2E-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: "B Customer",
    total: 100, subtotal: 100, tax: 0, status: "Sent",
  });
});

test.afterAll(async () => {
  if (bArtworkPath) await admin.storage.from("artwork").remove([bArtworkPath]).catch(() => {});
  await admin.from("orders").delete().eq("shop_owner", shopB?.email);
  await admin.from("invoices").delete().eq("shop_owner", shopB?.email);
  await Promise.all([deleteTestShop(shopA), deleteTestShop(shopB)]);
});

test("shop A reads its own rows but NONE of shop B's (RLS isolation)", async () => {
  const a = await authedClient(shopA.email, shopA.password);

  // A sees its own quote (created by createTestShop).
  const ownQuotes = await a.from("quotes").select("id").eq("shop_owner", shopA.email);
  expect(ownQuotes.error).toBeNull();
  expect(ownQuotes.data.length).toBeGreaterThan(0);

  // A cannot see B's rows — RLS filters them to zero across every tenant table.
  for (const table of ["quotes", "orders", "customers", "invoices"]) {
    const res = await a.from(table).select("id").eq("shop_owner", shopB.email);
    expect(res.error, `${table} query should not error`).toBeNull();
    expect(res.data, `shop A must not read shop B's ${table}`).toHaveLength(0);
  }
});

test("shop A cannot sign shop B's artwork object (storage policy isolation)", async () => {
  const a = await authedClient(shopA.email, shopA.password);
  const { data, error } = await a.storage.from("artwork").createSignedUrl(bArtworkPath, 60);
  // Either an explicit error or a null signed URL — both mean "denied". A
  // successful sign of another tenant's artwork is the regression we guard.
  expect(Boolean(error) || !data?.signedUrl).toBe(true);
});
