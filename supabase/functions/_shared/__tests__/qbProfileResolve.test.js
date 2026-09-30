import { describe, it, expect } from "vitest";
import { shouldUseOwnerQbFallback } from "../qbProfileResolve.js";

describe("shouldUseOwnerQbFallback — brokers never borrow the shop's QB", () => {
  it("BROKER with no own token → NO fallback (they are 'not connected', never the shop's)", () => {
    // This is the P1-critical case: 6 real brokers have shop_owner set + no own
    // token. They must NOT resolve to the shop's QuickBooks.
    expect(shouldUseOwnerQbFallback({ role: "broker", shop_owner: "shop@x.com", qb_access_token: null })).toBe(false);
    expect(shouldUseOwnerQbFallback({ role: "broker", shop_owner: "shop@x.com" })).toBe(false);
  });

  it("BROKER with their own token → NO fallback (uses their own; not the shop's)", () => {
    expect(shouldUseOwnerQbFallback({ role: "broker", shop_owner: "shop@x.com", qb_access_token: "tok" })).toBe(false);
  });

  it("TEAM MEMBER (manager/employee) with no own token + a shop → falls back to the shop", () => {
    expect(shouldUseOwnerQbFallback({ role: "manager", shop_owner: "shop@x.com", qb_access_token: null })).toBe(true);
    expect(shouldUseOwnerQbFallback({ role: "employee", shop_owner: "shop@x.com", qb_access_token: null })).toBe(true);
  });

  it("OWNER (has own token) → no fallback (uses their own connection)", () => {
    expect(shouldUseOwnerQbFallback({ role: "shop", shop_owner: null, qb_access_token: "tok" })).toBe(false);
  });

  it("no shop attached → no fallback", () => {
    expect(shouldUseOwnerQbFallback({ role: "manager", shop_owner: null, qb_access_token: null })).toBe(false);
  });

  it("null/undefined profile → no fallback (never throws)", () => {
    expect(shouldUseOwnerQbFallback(null)).toBe(false);
    expect(shouldUseOwnerQbFallback(undefined)).toBe(false);
  });
});
