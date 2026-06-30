// ACCOUNT-DELETION PURGE (PRIV-01 / NEW-04) — after a shop purges its account,
// ZERO rows remain for it across every tenant table, and its artwork object is
// gone from storage. Drives the real `adminAction` purgeShopData edge function
// as the owner (self-serve deletion), then asserts emptiness via service role.
import { test, expect } from "@playwright/test";
import { admin, authedClient } from "./_helpers/supabaseClients.js";
import { createTestShop } from "./_helpers/testShop.js";
import { SHOP_PURGE_TABLES } from "../supabase/functions/_shared/shopPurge.js";

let shop;
let artworkPath;

test.beforeAll(async () => {
  shop = await createTestShop();
  // Seed an order + an artwork object referenced by it, so the purge has both
  // rows and storage to clear.
  artworkPath = `e2e-purge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  await admin.storage.from("artwork").upload(artworkPath, Uint8Array.from([137, 80, 78, 71]), { contentType: "image/png", upsert: true });
  const fileUrl = `${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL}/storage/v1/object/public/artwork/${artworkPath}`;
  await admin.from("orders").insert({
    shop_owner: shop.email,
    order_id: `ORD-PURGE-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: "Purge Test", status: "Art Approval", total: 0, subtotal: 0, tax: 0,
    selected_artwork: [{ id: artworkPath, name: "p.png", path: artworkPath, url: fileUrl }],
  });
});

test.afterAll(async () => {
  // Best-effort: the purge should have removed everything, but clean up anything
  // it left (and the auth user) so a failed run doesn't leak fixtures.
  if (artworkPath) await admin.storage.from("artwork").remove([artworkPath]).catch(() => {});
  for (const { table, column } of SHOP_PURGE_TABLES) {
    await admin.from(table).delete().eq(column, shop?.email).catch(() => {});
  }
  if (shop?.authId) await admin.auth.admin.deleteUser(shop.authId).catch(() => {});
});

test("self-serve purge leaves zero rows + zero artwork for the shop", async () => {
  const owner = await authedClient(shop.email, shop.password);

  const { data, error } = await owner.functions.invoke("adminAction", {
    body: { action: "purgeShopData", shopOwner: shop.email, confirm: shop.email },
  });
  expect(error, error?.message).toBeFalsy();
  expect(data?.error, data?.error).toBeFalsy();

  // Every tenant table must be empty for this shop.
  for (const { table, column } of SHOP_PURGE_TABLES) {
    const { count, error: cErr } = await admin
      .from(table).select("*", { count: "exact", head: true }).eq(column, shop.email);
    expect(cErr, `${table} count should not error`).toBeNull();
    expect(count, `${table} must have 0 rows after purge`).toBe(0);
  }

  // The artwork object must be gone from storage.
  const { data: pub } = admin.storage.from("artwork").getPublicUrl(artworkPath);
  const resp = await fetch(pub.publicUrl);
  expect(resp.status, "artwork object should no longer resolve").not.toBe(200);
});
