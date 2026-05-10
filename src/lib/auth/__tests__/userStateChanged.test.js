import { describe, it, expect } from "vitest";
import {
  userStateChanged,
  USER_STATE_COMPARED_FIELDS,
} from "../userStateChanged";

const BASE = {
  id: "p-1",
  email: "owner@example.com",
  role: "user",
  subscription_tier: "trial",
  subscription_status: "trialing",
  // Fields that should be IGNORED for the change check:
  shop_name: "Cool Prints",
  phone: "555",
  default_tax_rate: 8.25,
};

describe("userStateChanged", () => {
  it("returns false when nothing meaningful changed", () => {
    expect(userStateChanged(BASE, { ...BASE })).toBe(false);
  });

  it("returns true when role changes (the post-confirm 'user' → 'shop' transition)", () => {
    expect(userStateChanged(BASE, { ...BASE, role: "shop" })).toBe(true);
  });

  it("returns true when subscription_tier changes", () => {
    expect(
      userStateChanged(BASE, { ...BASE, subscription_tier: "shop" })
    ).toBe(true);
  });

  it("returns true when subscription_status changes (e.g., trialing → active)", () => {
    expect(
      userStateChanged(BASE, { ...BASE, subscription_status: "active" })
    ).toBe(true);
  });

  it("returns true when email changes", () => {
    expect(userStateChanged(BASE, { ...BASE, email: "other@example.com" })).toBe(true);
  });

  it("returns true when id changes", () => {
    expect(userStateChanged(BASE, { ...BASE, id: "p-2" })).toBe(true);
  });

  it("ignores changes to shop_name, phone, tax rate, and other UI-only fields", () => {
    expect(
      userStateChanged(BASE, { ...BASE, shop_name: "Different", phone: "999", default_tax_rate: 0 })
    ).toBe(false);
  });

  it("returns true when prev is null and next is a user", () => {
    expect(userStateChanged(null, BASE)).toBe(true);
    expect(userStateChanged(undefined, BASE)).toBe(true);
  });

  it("returns false when both are null/undefined", () => {
    expect(userStateChanged(null, null)).toBe(false);
    expect(userStateChanged(null, undefined)).toBe(false);
    expect(userStateChanged(undefined, undefined)).toBe(false);
  });

  it("returns true when next is null and prev was a user", () => {
    expect(userStateChanged(BASE, null)).toBe(true);
  });

  it("locks down the compared-fields set so future additions are intentional", () => {
    // If you intentionally add or remove a field, update both this list AND
    // the userStateChanged() implementation. Keeping them in sync is the point.
    expect(USER_STATE_COMPARED_FIELDS).toEqual([
      "id",
      "email",
      "role",
      "subscription_tier",
      "subscription_status",
    ]);
  });
});
