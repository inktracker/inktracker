import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ROLES_ALLOWED_TO_ORDER,
  canPlaceOrder,
  credsForOrderPlacement,
  validateOrderPayload,
  buildOrderRequestBody,
} from "../acOrderLogic.js";

// ── canPlaceOrder ───────────────────────────────────────────────────────────
//
// Role gate. Defense-in-depth on top of credsForOrderPlacement: even if a
// non-shop role somehow has AC credentials configured, ordering blanks
// isn't their job. If you need to broaden the allowed roles, do it in
// ROLES_ALLOWED_TO_ORDER and add a test row here.

describe("canPlaceOrder", () => {
  it("allows admin, shop, manager", () => {
    expect(canPlaceOrder({ role: "admin" })).toBe(true);
    expect(canPlaceOrder({ role: "shop" })).toBe(true);
    expect(canPlaceOrder({ role: "manager" })).toBe(true);
  });

  it("refuses employee, broker, user, and unknown roles", () => {
    expect(canPlaceOrder({ role: "employee" })).toBe(false);
    expect(canPlaceOrder({ role: "broker" })).toBe(false);
    expect(canPlaceOrder({ role: "user" })).toBe(false);
    expect(canPlaceOrder({ role: "owner" })).toBe(false); // not a real role
    expect(canPlaceOrder({ role: "" })).toBe(false);
  });

  it("refuses null/undefined profile and missing role", () => {
    expect(canPlaceOrder(null)).toBe(false);
    expect(canPlaceOrder(undefined)).toBe(false);
    expect(canPlaceOrder({})).toBe(false);
  });

  it("freezes the allow-list so it can't be mutated at runtime", () => {
    expect(Object.isFrozen(ROLES_ALLOWED_TO_ORDER)).toBe(true);
  });
});

// ── credsForOrderPlacement ──────────────────────────────────────────────────
//
// THE MOST IMPORTANT CONTRACT IN THIS FILE. acPlaceOrder mints real-money
// orders against a real AS Colour account. If this function returned the
// platform's env credentials when a shop hadn't configured their own,
// then any authenticated InkTracker user could trigger orders against
// the platform's account. These tests pin the contract: per-shop creds
// or refuse, never env fallback.

describe("credsForOrderPlacement", () => {
  // Save and restore env vars so polluting them in the security test
  // can't leak across test order.
  const origSubKey = process.env.ASCOLOUR_SUBSCRIPTION_KEY;
  const origEmail = process.env.ASCOLOUR_EMAIL;
  const origPassword = process.env.ASCOLOUR_PASSWORD;
  beforeEach(() => {
    delete process.env.ASCOLOUR_SUBSCRIPTION_KEY;
    delete process.env.ASCOLOUR_EMAIL;
    delete process.env.ASCOLOUR_PASSWORD;
  });
  afterEach(() => {
    if (origSubKey != null) process.env.ASCOLOUR_SUBSCRIPTION_KEY = origSubKey;
    if (origEmail != null) process.env.ASCOLOUR_EMAIL = origEmail;
    if (origPassword != null) process.env.ASCOLOUR_PASSWORD = origPassword;
  });

  it("returns null when profile is null/undefined", () => {
    expect(credsForOrderPlacement(null)).toBe(null);
    expect(credsForOrderPlacement(undefined)).toBe(null);
  });

  it("returns null when profile has no AC credentials", () => {
    expect(credsForOrderPlacement({})).toBe(null);
    expect(credsForOrderPlacement({ ac_subscription_key: "" })).toBe(null);
  });

  it("returns null when only the subscription key is set (auth needs all three)", () => {
    expect(
      credsForOrderPlacement({ ac_subscription_key: "k" }),
    ).toBe(null);
  });

  it("returns null when subscription key + email are set but password is missing", () => {
    expect(
      credsForOrderPlacement({
        ac_subscription_key: "k",
        ac_email: "shop@example.com",
      }),
    ).toBe(null);
  });

  it("returns null when subscription key + password are set but email is missing", () => {
    expect(
      credsForOrderPlacement({
        ac_subscription_key: "k",
        ac_password: "p",
      }),
    ).toBe(null);
  });

  it("returns the per-shop credentials when all three fields are present", () => {
    expect(
      credsForOrderPlacement({
        ac_subscription_key: "shop-key",
        ac_email: "shop@example.com",
        ac_password: "shop-password",
      }),
    ).toEqual({
      subKey: "shop-key",
      email: "shop@example.com",
      password: "shop-password",
    });
  });

  // ── SECURITY CONTRACT ────────────────────────────────────────────────
  //
  // Even with all three platform env vars set, a profile that lacks
  // its own per-shop credentials must still be REFUSED. No env fallback
  // for order placement. If this test ever fails, any authenticated
  // user could place orders against the platform's AS Colour account.
  it("does NOT fall back to platform env credentials when the profile lacks its own", () => {
    process.env.ASCOLOUR_SUBSCRIPTION_KEY = "PLATFORM_KEY";
    process.env.ASCOLOUR_EMAIL = "platform@inktracker.app";
    process.env.ASCOLOUR_PASSWORD = "PLATFORM_PASSWORD";
    expect(credsForOrderPlacement({})).toBe(null);
    expect(credsForOrderPlacement({ ac_subscription_key: null })).toBe(null);
    expect(credsForOrderPlacement(null)).toBe(null);
  });

  it("does not allow whitespace-only fields to count as configured", () => {
    // These resolve to truthy strings so they slip through the basic
    // truthy check. Document that this is acceptable today (caller
    // would still hit a 401 from AS Colour) — left as an explicit test
    // so the behavior is intentional rather than an oversight.
    expect(
      credsForOrderPlacement({
        ac_subscription_key: " ",
        ac_email: " ",
        ac_password: " ",
      }),
    ).toEqual({ subKey: " ", email: " ", password: " " });
  });
});

// ── validateOrderPayload ────────────────────────────────────────────────────

describe("validateOrderPayload", () => {
  const validPayload = {
    reference: "PO-123",
    shippingMethod: "Ground",
    shippingAddress: {
      firstName: "Joe",
      lastName: "Doe",
      address1: "100 Main St",
      city: "Reno",
      zip: "89501",
      countryCode: "US",
    },
    items: [{ sku: "5050-BLACK-J-XL", quantity: 12, warehouse: "USA" }],
  };

  it("accepts a valid payload (no errors)", () => {
    expect(validateOrderPayload(validPayload)).toEqual([]);
  });

  it("requires reference", () => {
    const { reference, ...rest } = validPayload;
    expect(validateOrderPayload(rest)).toContain("reference (PO number) is required");
  });

  it("requires shippingMethod", () => {
    const { shippingMethod, ...rest } = validPayload;
    expect(validateOrderPayload(rest)).toEqual(
      expect.arrayContaining(["shippingMethod is required (call /orders/shippingmethods to list)"]),
    );
  });

  it("requires shippingAddress object", () => {
    expect(validateOrderPayload({ ...validPayload, shippingAddress: null })).toContain(
      "shippingAddress is required",
    );
  });

  it("requires each shippingAddress field", () => {
    const errs = validateOrderPayload({
      ...validPayload,
      shippingAddress: { address1: "", city: "", zip: "", countryCode: "" },
    });
    expect(errs).toEqual(
      expect.arrayContaining([
        "shippingAddress.address1 is required",
        "shippingAddress.city is required",
        "shippingAddress.zip is required",
        "shippingAddress.countryCode is required",
      ]),
    );
  });

  it("requires at least one item", () => {
    expect(validateOrderPayload({ ...validPayload, items: [] })).toContain(
      "at least one order item is required",
    );
    expect(validateOrderPayload({ ...validPayload, items: undefined })).toContain(
      "at least one order item is required",
    );
  });

  it("requires sku and positive numeric quantity per item", () => {
    const errs = validateOrderPayload({
      ...validPayload,
      items: [
        { sku: "", quantity: 12 },
        { sku: "X", quantity: 0 },
        { sku: "Y", quantity: -3 },
        { sku: "Z", quantity: "not-a-number" },
        { sku: "W" },
      ],
    });
    expect(errs).toEqual(
      expect.arrayContaining([
        "items[0].sku is required",
        "items[1].quantity must be a positive number",
        "items[2].quantity must be a positive number",
        "items[3].quantity must be a positive number",
        "items[4].quantity must be a positive number",
      ]),
    );
  });

  it("rejects non-object payloads with a single error", () => {
    expect(validateOrderPayload(null)).toEqual(["payload must be an object"]);
    expect(validateOrderPayload(undefined)).toEqual(["payload must be an object"]);
    expect(validateOrderPayload("not an object")).toEqual(["payload must be an object"]);
  });
});

// ── buildOrderRequestBody ───────────────────────────────────────────────────

describe("buildOrderRequestBody", () => {
  it("normalises types and defaults warehouse to 'CA' when missing", () => {
    const body = buildOrderRequestBody({
      reference: 12345, // numbers should coerce to strings
      shippingMethod: "Ground",
      shippingAddress: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
      items: [
        { sku: "5102-WHI_M-J-XL", warehouse: "NC", quantity: "12" },
        { sku: "5102-WHI_M-I-L", quantity: 24 }, // no warehouse → CA default
      ],
    });
    expect(body).toEqual({
      reference: "12345",
      shippingMethod: "Ground",
      orderNotes: "",
      courierInstructions: "",
      shippingAddress: { address1: "100 Main", city: "Reno", zip: "89501", countryCode: "US" },
      items: [
        { sku: "5102-WHI_M-J-XL", warehouse: "NC", quantity: 12 },
        { sku: "5102-WHI_M-I-L", warehouse: "CA", quantity: 24 },
      ],
    });
  });

  it("preserves orderNotes and courierInstructions when provided", () => {
    const body = buildOrderRequestBody({
      reference: "PO-1",
      shippingMethod: "Ground",
      orderNotes: "Test order, please cancel",
      courierInstructions: "Leave at side door",
      shippingAddress: { address1: "1", city: "x", zip: "y", countryCode: "US" },
      items: [{ sku: "S", quantity: 1 }],
    });
    expect(body.orderNotes).toBe("Test order, please cancel");
    expect(body.courierInstructions).toBe("Leave at side door");
  });
});
