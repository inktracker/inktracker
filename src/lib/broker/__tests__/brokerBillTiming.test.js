import { describe, it, expect } from "vitest";
import { isBrokerBillUpFront, decideUpFrontBill } from "../brokerBillTiming";

describe("isBrokerBillUpFront", () => {
  it("true only when the row's bill_up_front is exactly true", () => {
    expect(isBrokerBillUpFront({ bill_up_front: true })).toBe(true);
    expect(isBrokerBillUpFront({ bill_up_front: false })).toBe(false);
    expect(isBrokerBillUpFront({})).toBe(false);
    expect(isBrokerBillUpFront(null)).toBe(false);
    expect(isBrokerBillUpFront(undefined)).toBe(false);
  });
});

describe("decideUpFrontBill — the order-creation trigger", () => {
  it("bills now only when broker order + master on + broker up-front", () => {
    expect(decideUpFrontBill({ isBrokerOrder: true, masterEnabled: true, billUpFront: true })).toBe(true);
  });

  it("does NOT bill up front when the broker is on-completion (default)", () => {
    expect(decideUpFrontBill({ isBrokerOrder: true, masterEnabled: true, billUpFront: false })).toBe(false);
  });

  it("does NOT bill when the shop's master switch is off", () => {
    expect(decideUpFrontBill({ isBrokerOrder: true, masterEnabled: false, billUpFront: true })).toBe(false);
  });

  it("does NOT bill a non-broker order", () => {
    expect(decideUpFrontBill({ isBrokerOrder: false, masterEnabled: true, billUpFront: true })).toBe(false);
  });

  it("coerces falsy/missing inputs to false (never bills on ambiguous input)", () => {
    expect(decideUpFrontBill({})).toBe(false);
    expect(decideUpFrontBill({ isBrokerOrder: true, masterEnabled: true, billUpFront: undefined })).toBe(false);
  });
});
