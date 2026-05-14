import { describe, it, expect } from "vitest";
import { getQuoteTotalSafe, getClientTotalSafe } from "../quoteTotals.js";

const brokerCalc = (q) => ({ total: (q?.line_items?.length || 0) * 50 });
const clientCalc = (q) => ({ total: (q?.line_items?.length || 0) * 70 });

describe("getQuoteTotalSafe", () => {
  it("returns the broker calc total", () => {
    expect(getQuoteTotalSafe({ line_items: [1, 2] }, brokerCalc)).toBe(100);
  });

  it("ALWAYS recomputes via the calc — ignores quote.total even if saved", () => {
    // Broker total is never saved on the quote (we save retail total),
    // so a saved quote.total must NOT shortcut the broker calc.
    expect(getQuoteTotalSafe({ total: 999, line_items: [1] }, brokerCalc)).toBe(50);
  });

  it("returns 0 when calc throws", () => {
    expect(getQuoteTotalSafe({ line_items: [1] }, () => { throw new Error("bad"); })).toBe(0);
  });

  it("returns 0 when calc returns no total", () => {
    expect(getQuoteTotalSafe({}, () => ({}))).toBe(0);
    expect(getQuoteTotalSafe({}, () => null)).toBe(0);
  });

  it("survives null/undefined quote", () => {
    expect(getQuoteTotalSafe(null, brokerCalc)).toBe(0);
    expect(getQuoteTotalSafe(undefined, brokerCalc)).toBe(0);
  });
});

describe("getClientTotalSafe", () => {
  it("prefers the saved quote.total when present and positive", () => {
    expect(getClientTotalSafe({ total: 123, line_items: [1, 2] }, clientCalc)).toBe(123);
  });

  it("falls back to calc when total is 0", () => {
    expect(getClientTotalSafe({ total: 0, line_items: [1, 2] }, clientCalc)).toBe(140);
  });

  it("falls back to calc when total is missing", () => {
    expect(getClientTotalSafe({ line_items: [1] }, clientCalc)).toBe(70);
  });

  it("returns 0 when calc throws and no saved total", () => {
    expect(getClientTotalSafe({}, () => { throw new Error(); })).toBe(0);
  });

  it("ignores non-finite saved totals", () => {
    expect(getClientTotalSafe({ total: NaN, line_items: [1] }, clientCalc)).toBe(70);
    expect(getClientTotalSafe({ total: "abc", line_items: [1] }, clientCalc)).toBe(70);
  });

  it("ignores negative saved totals (treats as missing)", () => {
    expect(getClientTotalSafe({ total: -5, line_items: [1] }, clientCalc)).toBe(70);
  });
});
