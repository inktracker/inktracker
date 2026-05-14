import { describe, it, expect } from "vitest";
import {
  filterByPeriod,
  pipelineCounts,
  performanceMetrics,
  STATUS_KEYS,
} from "../analytics.js";

// Anchor "now" to a fixed timestamp so date math is deterministic.
const NOW = new Date("2026-05-14T00:00:00Z").getTime();
const days = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe("filterByPeriod", () => {
  const quotes = [
    { id: "1", created_date: days(10) },
    { id: "2", created_date: days(45) },
    { id: "3", created_date: days(100) },
    { id: "4", created_date: days(400) },
  ];

  it("returns everything when period is falsy (= 'all time')", () => {
    expect(filterByPeriod(quotes, null, NOW)).toHaveLength(4);
    expect(filterByPeriod(quotes, 0, NOW)).toHaveLength(4);
  });

  it("keeps quotes within the last N days", () => {
    expect(filterByPeriod(quotes, 30, NOW).map((q) => q.id)).toEqual(["1"]);
    expect(filterByPeriod(quotes, 60, NOW).map((q) => q.id)).toEqual(["1", "2"]);
    expect(filterByPeriod(quotes, 365, NOW).map((q) => q.id)).toEqual(["1", "2", "3"]);
  });

  it("falls back to `date` field when `created_date` is missing", () => {
    const mixed = [
      { id: "a", date: days(5) },
      { id: "b", date: days(50) },
    ];
    expect(filterByPeriod(mixed, 30, NOW).map((q) => q.id)).toEqual(["a"]);
  });

  it("drops quotes with no usable date instead of crashing", () => {
    const broken = [{ id: "1" }, { id: "2", created_date: "not-a-date" }, { id: "3", created_date: days(5) }];
    expect(filterByPeriod(broken, 30, NOW).map((q) => q.id)).toEqual(["3"]);
  });

  it("returns empty array on null/undefined input", () => {
    expect(filterByPeriod(null, 30, NOW)).toEqual([]);
    expect(filterByPeriod(undefined, 30, NOW)).toEqual([]);
  });
});

describe("pipelineCounts", () => {
  it("counts each status in the canonical order", () => {
    const out = pipelineCounts([
      { status: "Pending" }, { status: "Pending" },
      { status: "Approved" },
      { status: "Draft" },
      { status: "Other" }, // unknown statuses don't appear in output
    ]);
    expect(out).toEqual([
      { status: "Draft", count: 1 },
      { status: "Pending", count: 2 },
      { status: "Approved", count: 1 },
      { status: "Declined", count: 0 },
    ]);
  });

  it("always returns all 4 canonical buckets even when the list is empty", () => {
    const out = pipelineCounts([]);
    expect(out.map((b) => b.status)).toEqual(STATUS_KEYS);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });

  it("survives null/undefined input", () => {
    expect(pipelineCounts(null).every((b) => b.count === 0)).toBe(true);
    expect(pipelineCounts(undefined).every((b) => b.count === 0)).toBe(true);
  });
});

describe("performanceMetrics", () => {
  // Stub totals function — returns 100 per item.
  const fixedTotal = () => ({ total: 100 });

  it("computes total / approved / conversionRate", () => {
    const out = performanceMetrics(
      [{ status: "Pending" }, { status: "Approved" }, { status: "Approved" }, { status: "Declined" }],
      fixedTotal,
    );
    expect(out.total).toBe(4);
    expect(out.approved).toBe(2);
    expect(out.conversionRate).toBe(50);
  });

  it("rounds conversionRate to a whole percentage", () => {
    const out = performanceMetrics(
      [{ status: "Approved" }, { status: "Pending" }, { status: "Pending" }],
      fixedTotal,
    );
    expect(out.conversionRate).toBe(33); // 1/3 = 33.3...
  });

  it("returns 0 conversion when there are no quotes (no division by zero)", () => {
    const out = performanceMetrics([], fixedTotal);
    expect(out.conversionRate).toBe(0);
    expect(out.total).toBe(0);
    expect(out.totalValue).toBe(0);
    expect(out.avgValue).toBe(0);
  });

  it("sums totalValue across quotes with line items", () => {
    const out = performanceMetrics(
      [
        { line_items: [{ sku: "x" }], status: "Pending" },
        { line_items: [{ sku: "y" }], status: "Approved" },
        { line_items: [], status: "Draft" }, // excluded — no line items
      ],
      fixedTotal,
    );
    expect(out.totalValue).toBe(200); // two contributing × 100
    expect(out.avgValue).toBe(100);
  });

  it("swallows calc errors without crashing the totals", () => {
    const out = performanceMetrics(
      [{ line_items: [{ sku: "x" }] }, { line_items: [{ sku: "y" }] }],
      (q) => { if (q.line_items[0].sku === "x") throw new Error("calc failed"); return { total: 50 }; },
    );
    expect(out.totalValue).toBe(50); // 'x' threw, 'y' contributed 50
  });

  it("avgValue ignores quotes with no line items in the denominator", () => {
    const out = performanceMetrics(
      [
        { line_items: [{ sku: "x" }], status: "Pending" },
        { line_items: [], status: "Draft" },
      ],
      () => ({ total: 80 }),
    );
    expect(out.avgValue).toBe(80); // not 40 — empty quote not divided
  });
});
