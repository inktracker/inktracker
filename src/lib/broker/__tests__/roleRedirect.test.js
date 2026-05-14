import { describe, it, expect } from "vitest";
import { resolveRoleRedirect } from "../roleRedirect.js";

describe("resolveRoleRedirect", () => {
  it("redirects broker on any non-broker page to BrokerDashboard", () => {
    expect(resolveRoleRedirect({ role: "broker" }, "Quotes")).toBe("BrokerDashboard");
    expect(resolveRoleRedirect({ role: "broker" }, "Dashboard")).toBe("BrokerDashboard");
    expect(resolveRoleRedirect({ role: "broker" }, "AdminPanel")).toBe("BrokerDashboard");
    expect(resolveRoleRedirect({ role: "broker" }, "ShopFloor")).toBe("BrokerDashboard");
  });

  it("returns null when broker is already on BrokerDashboard", () => {
    expect(resolveRoleRedirect({ role: "broker" }, "BrokerDashboard")).toBe(null);
  });

  it("redirects employee on any non-floor page to ShopFloor", () => {
    expect(resolveRoleRedirect({ role: "employee" }, "Quotes")).toBe("ShopFloor");
    expect(resolveRoleRedirect({ role: "employee" }, "BrokerDashboard")).toBe("ShopFloor");
  });

  it("returns null when employee is already on ShopFloor", () => {
    expect(resolveRoleRedirect({ role: "employee" }, "ShopFloor")).toBe(null);
  });

  it("never redirects shop owners", () => {
    expect(resolveRoleRedirect({ role: "shop" }, "Quotes")).toBe(null);
    expect(resolveRoleRedirect({ role: "shop" }, "Dashboard")).toBe(null);
  });

  it("never redirects admins or managers", () => {
    expect(resolveRoleRedirect({ role: "admin" }, "Quotes")).toBe(null);
    expect(resolveRoleRedirect({ role: "manager" }, "Production")).toBe(null);
  });

  it("returns null for the pre-activation 'user' role (lets onboarding flow handle it)", () => {
    expect(resolveRoleRedirect({ role: "user" }, "Dashboard")).toBe(null);
  });

  it("returns null when user is missing (auth flow handles login redirect, not this fn)", () => {
    expect(resolveRoleRedirect(null, "Quotes")).toBe(null);
    expect(resolveRoleRedirect(undefined, "Quotes")).toBe(null);
  });

  it("a broker on BrokerDashboard with no defined role still gets no redirect", () => {
    // Defensive: if role is missing, we don't have grounds to redirect.
    expect(resolveRoleRedirect({ role: undefined }, "BrokerDashboard")).toBe(null);
  });
});
