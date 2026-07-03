import { describe, it, expect } from "vitest";
import { initialSlipQuantities, totalSlipUnits } from "../packingSlip";

// The packing slip tells the customer what physically shipped, so the
// count math is the contract that matters: ordered minus recorded
// misprints, never negative, resilient to legacy orders missing fields.

const ORDER = {
  line_items: [
    {
      id: "li1",
      style: "PC61",
      sizes: { S: 10, M: 15, L: 5 },
      _shortfall: { M: 2 },
    },
    {
      id: "li2",
      style: "3001",
      sizes: { S: "8", XL: 4 }, // sizes sometimes stored as strings
      // no _shortfall at all (orders predating the field)
    },
  ],
};

describe("initialSlipQuantities", () => {
  it("deducts recorded misprints from the ordered qty per size", () => {
    const q = initialSlipQuantities(ORDER);
    expect(q[0]).toEqual({ S: 10, M: 13, L: 5 });
  });

  it("treats a missing _shortfall as zero misprints", () => {
    const q = initialSlipQuantities(ORDER);
    expect(q[1]).toEqual({ S: 8, XL: 4 });
  });

  it("floors at 0 when misprints exceed the ordered qty", () => {
    const q = initialSlipQuantities({
      line_items: [{ sizes: { S: 2 }, _shortfall: { S: 5 } }],
    });
    expect(q[0]).toEqual({ S: 0 });
  });

  it("coerces string quantities and ignores junk values", () => {
    const q = initialSlipQuantities({
      line_items: [{ sizes: { S: "12", M: "abc" }, _shortfall: { S: "3" } }],
    });
    expect(q[0]).toEqual({ S: 9, M: 0 });
  });

  it("handles empty/missing orders and line items gracefully", () => {
    expect(initialSlipQuantities(null)).toEqual({});
    expect(initialSlipQuantities({})).toEqual({});
    expect(initialSlipQuantities({ line_items: [{}] })).toEqual({ 0: {} });
  });
});

describe("totalSlipUnits", () => {
  it("sums all sizes across all lines", () => {
    expect(totalSlipUnits(initialSlipQuantities(ORDER))).toBe(10 + 13 + 5 + 8 + 4);
  });

  it("tolerates in-progress empty-string cells from the editable inputs", () => {
    expect(totalSlipUnits({ 0: { S: "", M: 5 } })).toBe(5);
  });

  it("returns 0 for empty input", () => {
    expect(totalSlipUnits({})).toBe(0);
    expect(totalSlipUnits(null)).toBe(0);
  });
});
