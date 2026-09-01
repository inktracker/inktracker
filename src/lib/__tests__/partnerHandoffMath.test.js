import { describe, it, expect } from "vitest";
import { lineQty, lineRevenue, lineBlanksCost, computeHandoffComparison } from "../partnerHandoffMath";

const line = (over = {}) => ({
  sizes: { M: 20, L: 30 },          // 50 pcs
  clientPpp: 12,
  _lineTotal: 600,
  garmentCost: 4,
  ...over,
});

describe("line field extraction", () => {
  it("qty from sizes with quantity fallback", () => {
    expect(lineQty(line())).toBe(50);
    expect(lineQty({ sizes: {}, quantity: 25 })).toBe(25);
    expect(lineQty({})).toBe(0);
  });

  it("revenue prefers stored line total, falls back to ppp × qty", () => {
    expect(lineRevenue(line())).toBe(600);
    expect(lineRevenue(line({ _lineTotal: undefined, lineTotal: undefined }))).toBe(600); // 12 × 50
    expect(lineRevenue({})).toBe(0);
  });

  it("blanks cost is garmentCost × qty, zero for customer-supplied", () => {
    expect(lineBlanksCost(line())).toBe(200);
    expect(lineBlanksCost(line({ garmentCost: 0 }))).toBe(0);
  });
});

describe("computeHandoffComparison", () => {
  const lines = [line(), line({ sizes: { S: 50 }, _lineTotal: 500, garmentCost: 2 })]; // rev 1100, blanks 300

  it("decoration-only handoff: sender still pays blanks on the send side", () => {
    const c = computeHandoffComparison(lines, 350);
    expect(c).toMatchObject({ revenue: 1100, blanks: 300, keepGross: 800, sendMargin: 450, delta: -350, valid: true });
  });

  it("receiver-supplies-garments: blanks drop out of the send side only", () => {
    const c = computeHandoffComparison(lines, 350, { receiverSuppliesGarments: true });
    expect(c).toMatchObject({ keepGross: 800, sendMargin: 750, delta: -50, valid: true });
  });

  it("invalid or missing trade price yields keep-side numbers only", () => {
    const c = computeHandoffComparison(lines, "");
    expect(c.valid).toBe(false);
    expect(c.keepGross).toBe(800);
    expect(c.sendMargin).toBe(null);
  });

  it("empty selection is all zeros, never NaN", () => {
    const c = computeHandoffComparison([], 100);
    expect(c).toMatchObject({ revenue: 0, blanks: 0, keepGross: 0, valid: false });
  });
});
