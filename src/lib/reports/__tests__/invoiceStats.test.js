import { describe, it, expect } from "vitest";
import {
  computeOutstanding,
  computeOutstandingInRange,
  computeRevenueInRange,
} from "../invoiceStats";

const inv = (overrides) => ({ id: "i", date: "2026-05-01", total: 100, paid: false, ...overrides });

describe("computeOutstanding", () => {
  it("sums totals of unpaid invoices", () => {
    expect(computeOutstanding([
      inv({ total: 100 }),
      inv({ total: 250 }),
      inv({ total: 50, paid: true }), // excluded
    ])).toEqual({ total: 350, count: 2 });
  });

  it("ignores zero-total / negative invoices (don't inflate count)", () => {
    expect(computeOutstanding([
      inv({ total: 0 }),
      inv({ total: -10 }),
      inv({ total: 75 }),
    ])).toEqual({ total: 75, count: 1 });
  });

  it("rounds total to cents", () => {
    expect(computeOutstanding([
      inv({ total: 100.005 }),
      inv({ total: 200.004 }),
    ]).total).toBe(300.01);
  });

  it("returns zero state for empty / null / undefined", () => {
    expect(computeOutstanding([])).toEqual({ total: 0, count: 0 });
    expect(computeOutstanding(null)).toEqual({ total: 0, count: 0 });
    expect(computeOutstanding(undefined)).toEqual({ total: 0, count: 0 });
  });

  it("treats non-numeric total as zero (legacy data with bad columns)", () => {
    expect(computeOutstanding([
      inv({ total: "abc" }),
      inv({ total: null }),
      inv({ total: 100 }),
    ])).toEqual({ total: 100, count: 1 });
  });

  it("skips holes in the array (sparse data)", () => {
    const sparse = [inv({ total: 100 }), null, inv({ total: 50 }), undefined];
    expect(computeOutstanding(sparse)).toEqual({ total: 150, count: 2 });
  });
});

describe("computeOutstandingInRange", () => {
  const data = [
    inv({ id: "a", date: "2026-04-15", total: 100 }),
    inv({ id: "b", date: "2026-05-01", total: 200 }),
    inv({ id: "c", date: "2026-05-10", total: 50, paid: true }),  // excluded
    inv({ id: "d", date: "2026-06-01", total: 75 }),
  ];

  it("inclusive of both bounds", () => {
    expect(computeOutstandingInRange(data, "2026-05-01", "2026-06-01")).toEqual({ total: 275, count: 2 });
  });

  it("open-ended `from` includes everything up to `to`", () => {
    expect(computeOutstandingInRange(data, null, "2026-05-31")).toEqual({ total: 300, count: 2 });
  });

  it("open-ended `to` includes everything from `from` onward", () => {
    expect(computeOutstandingInRange(data, "2026-05-15", null)).toEqual({ total: 75, count: 1 });
  });

  it("ignores invoices with no date", () => {
    expect(computeOutstandingInRange([inv({ date: null, total: 100 })], "2026-01-01", "2026-12-31"))
      .toEqual({ total: 0, count: 0 });
  });
});

describe("computeRevenueInRange", () => {
  const data = [
    inv({ id: "a", date: "2026-04-15", total: 100, paid: true }),
    inv({ id: "b", date: "2026-05-01", total: 200, paid: true }),
    inv({ id: "c", date: "2026-05-10", total: 50,  paid: false }), // excluded
    inv({ id: "d", date: "2026-06-01", total: 75,  paid: true }),
  ];

  it("sums totals of PAID invoices in window", () => {
    expect(computeRevenueInRange(data, "2026-05-01", "2026-06-01")).toEqual({ total: 275, count: 2 });
  });

  it("returns zero state for empty inputs", () => {
    expect(computeRevenueInRange([], "2026-01-01", "2026-12-31")).toEqual({ total: 0, count: 0 });
  });

  it("ignores unpaid invoices even when in window", () => {
    expect(computeRevenueInRange([inv({ paid: false, total: 1000 })], null, null)).toEqual({ total: 0, count: 0 });
  });
});
