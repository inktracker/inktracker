// Regression: loadShopProfileForUser must resolve a MANAGER (and employee) to
// the OWNER's profile so supplier credentials (which live on the owner) are
// used for their orders — the "manager = full partnership" model. Before this,
// a manager's order used their own (credential-less) profile and was refused,
// or would have billed their personal account. Run: `npm run test:edge`.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeSupabase } from "../testing/fakeSupabase.ts";
import { loadShopProfileForUser } from "../profileSecrets.ts";

function db() {
  return fakeSupabase({
    profiles: [
      { id: "own-id", auth_id: "own-auth", email: "owner@x.com", role: "shop", shop_owner: null },
      { id: "mgr-id", auth_id: "mgr-auth", email: "mgr@x.com", role: "manager", shop_owner: "owner@x.com" },
      { id: "emp-id", auth_id: "emp-auth", email: "emp@x.com", role: "employee", shop_owner: "owner@x.com" },
    ],
    profile_secrets: [
      { profile_id: "own-id", ss_account_number: "12345", ss_api_key: "sskey" },
    ],
  });
}

Deno.test("manager resolves to the OWNER's profile + creds", async () => {
  const { profile, isBroker } = await loadShopProfileForUser(db(), "mgr-auth");
  assertEquals(isBroker, false);
  assertEquals(profile?.email, "owner@x.com"); // owner, not the manager
  assertEquals(profile?.ss_account_number, "12345"); // owner's creds available
});

Deno.test("employee resolves to the owner's profile too", async () => {
  const { profile } = await loadShopProfileForUser(db(), "emp-auth");
  assertEquals(profile?.email, "owner@x.com");
  assertEquals(profile?.ss_account_number, "12345");
});

Deno.test("owner keeps their own profile (no mis-swap)", async () => {
  const { profile } = await loadShopProfileForUser(db(), "own-auth");
  assertEquals(profile?.email, "owner@x.com");
  assert(profile?.ss_account_number === "12345");
});
