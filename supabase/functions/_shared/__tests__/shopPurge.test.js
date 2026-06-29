import { describe, it, expect } from "vitest";
import { SHOP_PURGE_TABLES, SHOP_PURGE_BUCKETS, authorizeShopPurge } from "../shopPurge.js";

describe("SHOP_PURGE_TABLES", () => {
  it("covers the known tenant tables and is frozen", () => {
    const names = SHOP_PURGE_TABLES.map((t) => t.table);
    for (const t of ["customers", "quotes", "orders", "invoices", "tax_records", "messages", "shops"]) {
      expect(names).toContain(t);
    }
    expect(Object.isFrozen(SHOP_PURGE_TABLES)).toBe(true);
  });
  it("uses owner_email for shops, shop_owner for everything else", () => {
    expect(SHOP_PURGE_TABLES.find((t) => t.table === "shops").column).toBe("owner_email");
    expect(SHOP_PURGE_TABLES.filter((t) => t.table !== "shops").every((t) => t.column === "shop_owner")).toBe(true);
  });
  it("has no duplicate tables", () => {
    const names = SHOP_PURGE_TABLES.map((t) => t.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("clears the private tax-certificate bucket", () => {
    expect(SHOP_PURGE_BUCKETS).toContain("tax-certificates");
  });
});

describe("authorizeShopPurge", () => {
  it("lets a platform admin purge any shop", () => {
    expect(authorizeShopPurge({ callerRole: "admin", callerShop: "me@x.co", targetEmail: "other@y.co", confirm: "other@y.co" }))
      .toEqual({ ok: true });
  });
  it("lets a shop owner purge ONLY their own shop", () => {
    expect(authorizeShopPurge({ callerRole: "shop", callerShop: "me@x.co", targetEmail: "me@x.co", confirm: "me@x.co" }))
      .toEqual({ ok: true });
  });
  it("refuses a shop owner purging another shop", () => {
    expect(authorizeShopPurge({ callerRole: "shop", callerShop: "me@x.co", targetEmail: "other@y.co", confirm: "other@y.co" }))
      .toEqual({ ok: false, reason: "forbidden" });
  });
  it("requires confirm to equal the target email (case/space-insensitive)", () => {
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "me@x.co", confirm: "" }).reason).toBe("confirm_mismatch");
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "me@x.co", confirm: "wrong@x.co" }).reason).toBe("confirm_mismatch");
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "Me@X.co", confirm: " me@x.co " })).toEqual({ ok: true });
  });
  it("refuses with no target", () => {
    expect(authorizeShopPurge({ callerRole: "admin", targetEmail: "", confirm: "" }).reason).toBe("no_target");
  });
});
