import { describe, it, expect } from "vitest";
import { shopScope } from "../shopScope";

describe("shopScope", () => {
  it("owner: shop_owner null → own email (no change vs old behavior)", () => {
    expect(shopScope({ email: "owner@shop.com", shop_owner: null, role: "shop" })).toBe("owner@shop.com");
  });
  it("manager: returns the OWNER's email, not their own", () => {
    expect(shopScope({ email: "manager@gmail.com", shop_owner: "owner@shop.com", role: "manager" })).toBe("owner@shop.com");
  });
  it("employee: same as manager", () => {
    expect(shopScope({ email: "emp@gmail.com", shop_owner: "owner@shop.com", role: "employee" })).toBe("owner@shop.com");
  });
  it("falls back to email when shop_owner is empty string", () => {
    expect(shopScope({ email: "a@b.com", shop_owner: "" })).toBe("a@b.com");
  });
  it("tolerates null/undefined user", () => {
    expect(shopScope(null)).toBe(null);
    expect(shopScope(undefined)).toBe(null);
  });
});
