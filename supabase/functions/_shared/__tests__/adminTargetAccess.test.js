import { describe, it, expect } from "vitest";
import { checkAdminTargetAccess, isAssignableRole } from "../adminTargetAccess.js";

// The bug class this helper guards against:
// Before extraction, adminAction's setRole + deleteUser had inline checks
// of the form `if (targetProfile) { isOwnShop check }`. When the DB lookup
// returned null (auth UUID with no profile / bogus profileId), the if-block
// was skipped and the privileged action proceeded unguarded. This let any
// authenticated shop user call `deleteUser` against an orphan auth UUID,
// or `setRole` to claim an orphan auth identity into their own shop.

describe("checkAdminTargetAccess", () => {
  describe("ok cases", () => {
    it("allows when target.shop_owner === adminEmail (target is in caller's shop)", () => {
      const target = { shop_owner: "joe@biotamfg.co", email: "alice@example.test", assigned_shops: [] };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: true });
    });

    it("allows when target.assigned_shops includes adminEmail (broker/manager assigned to target)", () => {
      const target = { shop_owner: "alice@example.test", email: "bob@example.test", assigned_shops: ["joe@biotamfg.co"] };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: true });
    });

    it("allows when target.email === adminEmail (self-modification)", () => {
      // A shop owner can edit/delete their own profile without it being
      // "in their shop" — they own their own user.
      const target = { shop_owner: "someone-else@example.test", email: "joe@biotamfg.co", assigned_shops: [] };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: true });
    });

    it("allows when shop_owner matches AND assigned_shops doesn't (single-criterion ok)", () => {
      const target = { shop_owner: "joe@biotamfg.co", email: "alice@example.test" /* no assigned_shops field */ };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: true });
    });
  });

  describe("forbidden cases", () => {
    it("refuses when targetProfile is null — the bug-class guard", () => {
      // Pre-fix, adminAction.deleteUser would skip its tenant check on a
      // null target and proceed to call auth.admin.deleteUser anyway.
      // The whole point of this helper is this case.
      expect(checkAdminTargetAccess({ targetProfile: null, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: false, reason: "not_found" });
    });

    it("refuses when targetProfile is undefined", () => {
      expect(checkAdminTargetAccess({ targetProfile: undefined, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: false, reason: "not_found" });
    });

    it("refuses when target belongs to a different shop with no overlap", () => {
      const target = { shop_owner: "alice@example.test", email: "bob@example.test", assigned_shops: ["carol@example.test"] };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: false, reason: "cross_shop" });
    });

    it("refuses when assigned_shops is a non-array (defensive)", () => {
      // RLS schema lets assigned_shops be NULL on profiles that aren't
      // brokers/managers. We must not crash on .includes() — and we must
      // not treat the malformed value as an open door.
      const target = { shop_owner: "alice@example.test", email: "bob@example.test", assigned_shops: "not-an-array" };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "joe@biotamfg.co" }))
        .toEqual({ ok: false, reason: "cross_shop" });
    });

    it("refuses when adminEmail is missing — fail closed on broken upstream auth", () => {
      // If callerProfile?.email AND user.email both came back null somehow,
      // the function must NOT match against an empty string and accidentally
      // wave through every target whose email is also empty.
      const target = { shop_owner: "", email: "", assigned_shops: ["", ""] };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "" }))
        .toEqual({ ok: false, reason: "cross_shop" });
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: null }))
        .toEqual({ ok: false, reason: "cross_shop" });
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: undefined }))
        .toEqual({ ok: false, reason: "cross_shop" });
    });

    it("doesn't accept an empty adminEmail matching empty target fields", () => {
      const target = { shop_owner: "", email: "", assigned_shops: [""] };
      expect(checkAdminTargetAccess({ targetProfile: target, adminEmail: "" }))
        .toEqual({ ok: false, reason: "cross_shop" });
    });
  });

  describe("defensive defaults", () => {
    it("returns not_found on empty args object", () => {
      expect(checkAdminTargetAccess({})).toEqual({ ok: false, reason: "not_found" });
    });

    it("returns not_found on no args at all", () => {
      expect(checkAdminTargetAccess()).toEqual({ ok: false, reason: "not_found" });
    });
  });
});

describe("isAssignableRole (SEC-06 — no minting admins via setRole)", () => {
  it("allows the tenant-scoped roles the AdminPanel uses", () => {
    for (const r of ["shop", "manager", "employee", "broker", "user"]) {
      expect(isAssignableRole(r)).toBe(true);
    }
  });
  it("rejects 'admin' and anything not on the allowlist", () => {
    expect(isAssignableRole("admin")).toBe(false);
    expect(isAssignableRole("superuser")).toBe(false);
    expect(isAssignableRole("")).toBe(false);
    expect(isAssignableRole(null)).toBe(false);
    expect(isAssignableRole(undefined)).toBe(false);
  });
});
