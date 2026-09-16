// SanMar PO-onboarding state machine + email builders (pure).
import { describe, it, expect } from "vitest";
import {
  normalizeOnboarding,
  isSanmarPoLive,
  currentStep,
  testPoNumber,
  testShipToFromProfile,
  buildRequestEmail,
  buildNotifyEmail,
  applyRequested,
  applyEdevSaved,
  applyTestSubmitted,
  applyNotified,
  applyLive,
  applyNotLive,
  DEFAULT_TEST_LINES,
  SANMAR_INTEGRATIONS_EMAIL,
} from "../sanmarOnboarding.js";

const profile = {
  company_name: "",
  shop_name: "Biota Mfg",
  address: "790 South Virginia St",
  city: "Reno",
  state: "NV",
  zip: "89501-2326",
  email: "owner@example.com",
};

describe("normalize / live flag / step", () => {
  it("treats garbage and unknown statuses as not_started", () => {
    expect(normalizeOnboarding(null).status).toBe("not_started");
    expect(normalizeOnboarding({ status: "bogus" }).status).toBe("not_started");
    expect(isSanmarPoLive({ status: "tested" })).toBe(false);
    expect(isSanmarPoLive({ status: "live" })).toBe(true);
  });

  it("maps statuses to stepper positions", () => {
    expect(currentStep({})).toBe(1);
    expect(currentStep({ status: "requested" })).toBe(2);
    expect(currentStep({ status: "edev_ready" })).toBe(3);
    expect(currentStep({ status: "tested" })).toBe(4);
    expect(currentStep({ status: "awaiting_sanmar" })).toBe(5);
    expect(currentStep({ status: "live" })).toBe(6);
  });
});

describe("test PO number + ship-to", () => {
  it("builds a comma-free, ≤28-char PO number from the shop name", () => {
    expect(testPoNumber("Biota Mfg", 1)).toBe("BIOTAMFG-TEST-1");
    expect(testPoNumber("Summit Screen & Print, LLC", 3)).toBe("SUMMITSCRE-TEST-3");
    expect(testPoNumber("", 0)).toBe("SHOP-TEST-1");
    expect(testPoNumber("X".repeat(40), 12).length).toBeLessThanOrEqual(28);
  });

  it("uses the production address from the profile and refuses when incomplete", () => {
    const ok = testShipToFromProfile(profile);
    expect(ok.shipTo).toMatchObject({ name: "Biota Mfg", address1: "790 South Virginia St", city: "Reno", state: "NV", zip: "89501-2326", email: "owner@example.com", residence: false });
    const bad = testShipToFromProfile({ ...profile, zip: "", city: "" });
    expect(bad.error).toMatch(/city, ZIP/);
    expect(bad.shipTo).toBeUndefined();
  });

  it("company_name wins over shop_name for the label name", () => {
    expect(testShipToFromProfile({ ...profile, company_name: "Biota LLC" }).shipTo.name).toBe("Biota LLC");
  });

  it("default test lines are SanMar's v24.5 EDEV products, multi-line", () => {
    expect(DEFAULT_TEST_LINES.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_TEST_LINES.map((l) => l.style)).toEqual(["PC61", "PC61", "PC55", "K500"]);
  });
});

describe("emails", () => {
  const shipTo = testShipToFromProfile(profile).shipTo;

  it("request email asks for EDEV creds, states shipping option + PSST bypass, and points replies at the shop", () => {
    const e = buildRequestEmail({ customerNumber: "198063", username: "biotamfg", shopName: "Biota Mfg", ownerName: "Joe", ownerEmail: "owner@example.com", shipTo });
    expect(e.subject).toContain("198063");
    expect(e.text).toContain("EDEV");
    expect(e.text).toContain("Warehouse Consolidation");
    expect(e.text).toMatch(/PSST.*bypass/);
    expect(e.text).toContain("790 South Virginia St");
    expect(e.text).toContain("reply to owner@example.com");
    expect(e.text).toContain('username "biotamfg"');
    expect(SANMAR_INTEGRATIONS_EMAIL).toBe("sanmarintegrations@sanmar.com");
  });

  it("notify email lists every test PO with its ship method and the production setup answers", () => {
    const e = buildNotifyEmail({
      customerNumber: "198063", username: "biotamfg", shopName: "Biota Mfg", ownerEmail: "owner@example.com", shipTo,
      tests: [{ po_number: "BIOTAMFG-TEST-1", ship_method: "UPS" }, { po_number: "BIOTAMFG-TEST-2", ship_method: "UPS 2ND DAY" }],
      paymentMethod: "Net 30",
    });
    expect(e.subject).toContain("BIOTAMFG-TEST-1, BIOTAMFG-TEST-2");
    expect(e.text).toContain("BIOTAMFG-TEST-2 (ship method UPS 2ND DAY)");
    expect(e.text).toContain("Payment method: Net 30");
    expect(e.text).toContain("Shipping label company name: Biota Mfg");
    expect(e.text).toMatch(/PSST: not used/);
  });
});

describe("state machine", () => {
  const ok = { po_number: "BIOTAMFG-TEST-1", ship_method: "UPS", result: { success: true, message: "PO Submission successful" } };

  it("walks request → edev → tested → awaiting → live", () => {
    let o = applyRequested({}, "t1");
    expect(o).toMatchObject({ status: "requested", requested_at: "t1" });
    o = applyEdevSaved(o, "t2");
    expect(o).toMatchObject({ status: "edev_ready", edev_saved_at: "t2" });
    o = applyTestSubmitted(o, ok, "t3");
    expect(o.status).toBe("tested");
    expect(o.tests).toHaveLength(1);
    o = applyNotified(o, "Net 30", "t4");
    expect(o).toMatchObject({ status: "awaiting_sanmar", notified_at: "t4", payment_method: "Net 30" });
    o = applyLive(o, "t5");
    expect(o).toMatchObject({ status: "live", live_at: "t5" });
    expect(isSanmarPoLive(o)).toBe(true);
    expect(applyNotLive(o).status).toBe("awaiting_sanmar");
  });

  it("lets a shop that already emailed SanMar skip step 1 by saving EDEV creds directly", () => {
    const o = applyEdevSaved({}, "t2");
    expect(o.status).toBe("edev_ready");
    expect(o.requested_at).toBe("t2");
  });

  it("refuses a test before EDEV creds, notify before a successful test, and live before notify", () => {
    expect(() => applyTestSubmitted({ status: "requested" }, ok)).toThrow(/EDEV/);
    expect(() => applyNotified({ status: "tested", tests: [{ po_number: "X", result: { success: false } }] }, "")).toThrow(/successful/);
    expect(() => applyLive({ status: "edev_ready" })).toThrow(/Tell SanMar/);
  });

  it("extra test orders after notifying keep awaiting_sanmar (per-ship-method tests)", () => {
    const o = applyTestSubmitted({ status: "awaiting_sanmar", tests: [ok] }, { ...ok, po_number: "BIOTAMFG-TEST-2", ship_method: "UPS 2ND DAY" });
    expect(o.status).toBe("awaiting_sanmar");
    expect(o.tests).toHaveLength(2);
  });

  it("a live shop stays live through re-saving creds and re-notifying", () => {
    expect(applyEdevSaved({ status: "live" }).status).toBe("live");
    expect(applyNotified({ status: "live", tests: [ok] }, "").status).toBe("live");
    expect(() => applyRequested({ status: "live" })).toThrow(/already live/);
  });
});
