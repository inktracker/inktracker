// Unit tests for the Press Scheduler pure helpers. The scheduler UI
// is the highest-stakes new surface (drag/drop writes that go
// straight to orders), so every helper that drives a chip's
// position, span, or capacity has explicit edge-case coverage here.

import { describe, it, expect } from "vitest";
import {
  daysBetween,
  dayIndex,
  spanDays,
  placementsForPress,
  hoursOnPressDay,
} from "../schedulerHelpers";

// Week strip used across many tests: 2026-06-01 (Mon) through 2026-06-07 (Sun).
const W = "2026-06-01";

describe("daysBetween", () => {
  it("returns 0 for the same day", () => {
    expect(daysBetween("2026-06-04", "2026-06-04")).toBe(0);
  });
  it("counts forward as positive", () => {
    expect(daysBetween("2026-06-04", "2026-06-05")).toBe(1);
    expect(daysBetween("2026-06-04", "2026-06-10")).toBe(6);
  });
  it("counts backward as negative", () => {
    expect(daysBetween("2026-06-04", "2026-06-03")).toBe(-1);
  });
  it("crosses month boundaries cleanly", () => {
    expect(daysBetween("2026-05-31", "2026-06-02")).toBe(2);
  });
  it("crosses year boundaries cleanly", () => {
    expect(daysBetween("2025-12-31", "2026-01-02")).toBe(2);
  });
  // DST is the historical foot-gun. Using noon-anchored Date objects
  // avoids the 23-hr / 25-hr edge cases that would otherwise round to
  // 0.96 or 1.04 and flip via Math.round.
  it("returns 1 across the US spring-forward DST boundary (2026-03-08)", () => {
    expect(daysBetween("2026-03-07", "2026-03-08")).toBe(1);
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
  });
  it("returns 1 across the US fall-back DST boundary (2026-11-01)", () => {
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
  });
});

describe("dayIndex", () => {
  it("returns null for missing input (so callers can skip rendering)", () => {
    expect(dayIndex(null, W)).toBeNull();
    expect(dayIndex(undefined, W)).toBeNull();
    expect(dayIndex("", W)).toBeNull();
  });
  it("maps the week-start to 0", () => {
    expect(dayIndex(W, W)).toBe(0);
  });
  it("maps Sunday of the same week to 6", () => {
    expect(dayIndex("2026-06-07", W)).toBe(6);
  });
  it("returns negative when iso is before the visible window", () => {
    expect(dayIndex("2026-05-30", W)).toBe(-2);
  });
  it("returns >= 7 when iso is after the visible window", () => {
    expect(dayIndex("2026-06-10", W)).toBe(9);
  });
});

describe("spanDays", () => {
  it("returns 1 for unscheduled orders so callers can safely divide hours", () => {
    expect(spanDays({})).toBe(1);
    expect(spanDays(null)).toBe(1);
    expect(spanDays({ scheduled_date: null })).toBe(1);
  });
  it("returns 1 for single-day jobs", () => {
    expect(spanDays({ scheduled_date: "2026-06-04" })).toBe(1);
    expect(spanDays({ scheduled_date: "2026-06-04", scheduled_end_date: "2026-06-04" })).toBe(1);
  });
  it("returns inclusive span length for multi-day jobs", () => {
    expect(spanDays({ scheduled_date: "2026-06-04", scheduled_end_date: "2026-06-05" })).toBe(2);
    expect(spanDays({ scheduled_date: "2026-06-04", scheduled_end_date: "2026-06-10" })).toBe(7);
  });
  it("clamps an inverted range to 1 instead of negative (defensive)", () => {
    // The DB CHECK should prevent this, but the helper has to remain
    // safe in case a row slipped through pre-migration.
    expect(spanDays({ scheduled_date: "2026-06-04", scheduled_end_date: "2026-06-03" })).toBe(1);
  });
});

// ── placementsForPress ────────────────────────────────────────────
// Helper: a minimal order
const o = (id, press, start, end, hours) => ({
  id,
  assigned_press: press,
  scheduled_date: start,
  scheduled_end_date: end ?? start,
  estimated_hours: hours,
});

describe("placementsForPress — filtering", () => {
  it("returns empty when no orders", () => {
    expect(placementsForPress([], "Auto 1", W)).toEqual({ items: [], maxStack: 0 });
  });
  it("filters by press name", () => {
    const orders = [
      o(1, "Auto 1", "2026-06-04"),
      o(2, "Manual A", "2026-06-04"),
    ];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items.map(p => p.order.id)).toEqual([1]);
  });
  it("excludes orders without a scheduled_date", () => {
    const orders = [
      o(1, "Auto 1", null),
      o(2, "Auto 1", "2026-06-04"),
    ];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items.map(p => p.order.id)).toEqual([2]);
  });
  it("excludes orders whose entire span is before the window", () => {
    const orders = [o(1, "Auto 1", "2026-05-20", "2026-05-25")];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items).toEqual([]);
  });
  it("excludes orders whose entire span is after the window", () => {
    const orders = [o(1, "Auto 1", "2026-06-10", "2026-06-15")];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items).toEqual([]);
  });
  it("handles defensive nulls in the orders array", () => {
    const orders = [null, undefined, o(1, "Auto 1", "2026-06-04")];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items.map(p => p.order.id)).toEqual([1]);
  });
});

describe("placementsForPress — clipping", () => {
  it("clips a chip that starts before the window", () => {
    const orders = [o(1, "Auto 1", "2026-05-30", "2026-06-02")];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items).toHaveLength(1);
    expect(items[0].startCol).toBe(0);
    expect(items[0].endCol).toBe(1);
    expect(items[0].clippedLeft).toBe(true);
    expect(items[0].clippedRight).toBe(false);
    expect(items[0].totalSpan).toBe(4);
  });
  it("clips a chip that ends after the window", () => {
    const orders = [o(1, "Auto 1", "2026-06-05", "2026-06-10")];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items).toHaveLength(1);
    expect(items[0].startCol).toBe(4);
    expect(items[0].endCol).toBe(6);
    expect(items[0].clippedLeft).toBe(false);
    expect(items[0].clippedRight).toBe(true);
  });
  it("clips on both sides when the chip spans the whole window and more", () => {
    const orders = [o(1, "Auto 1", "2026-05-25", "2026-06-15")];
    const { items } = placementsForPress(orders, "Auto 1", W);
    expect(items[0]).toMatchObject({
      startCol: 0, endCol: 6, clippedLeft: true, clippedRight: true,
    });
  });
});

describe("placementsForPress — greedy first-fit stacking", () => {
  it("places non-overlapping chips on the same stack (0)", () => {
    // Mon-Tue, then Wed-Thu, then Fri-Sat
    const orders = [
      o(1, "Auto 1", "2026-06-01", "2026-06-02"),
      o(2, "Auto 1", "2026-06-03", "2026-06-04"),
      o(3, "Auto 1", "2026-06-05", "2026-06-06"),
    ];
    const { items, maxStack } = placementsForPress(orders, "Auto 1", W);
    expect(items.map(p => p.stackIdx)).toEqual([0, 0, 0]);
    expect(maxStack).toBe(1);
  });
  it("stacks two overlapping chips on stacks 0 and 1", () => {
    const orders = [
      o(1, "Auto 1", "2026-06-01", "2026-06-04"),
      o(2, "Auto 1", "2026-06-03", "2026-06-06"),
    ];
    const { items, maxStack } = placementsForPress(orders, "Auto 1", W);
    expect(items.find(p => p.order.id === 1).stackIdx).toBe(0);
    expect(items.find(p => p.order.id === 2).stackIdx).toBe(1);
    expect(maxStack).toBe(2);
  });
  it("reuses a freed stack after the chip on it ends", () => {
    // o1: cols 0-1, o2: cols 0-3 (overlaps o1 → stack 1),
    // o3: cols 2-3 (after o1 → can reuse stack 0)
    const orders = [
      o(1, "Auto 1", "2026-06-01", "2026-06-02"),
      o(2, "Auto 1", "2026-06-01", "2026-06-04"),
      o(3, "Auto 1", "2026-06-03", "2026-06-04"),
    ];
    const { items, maxStack } = placementsForPress(orders, "Auto 1", W);
    expect(items.find(p => p.order.id === 1).stackIdx).toBe(0);
    expect(items.find(p => p.order.id === 2).stackIdx).toBe(1);
    expect(items.find(p => p.order.id === 3).stackIdx).toBe(0);
    expect(maxStack).toBe(2);
  });
  it("handles three-deep overlap (stacks 0, 1, 2)", () => {
    const orders = [
      o(1, "Auto 1", "2026-06-01", "2026-06-05"),
      o(2, "Auto 1", "2026-06-02", "2026-06-04"),
      o(3, "Auto 1", "2026-06-03", "2026-06-06"),
    ];
    const { maxStack } = placementsForPress(orders, "Auto 1", W);
    expect(maxStack).toBe(3);
  });
});

describe("hoursOnPressDay", () => {
  it("returns 0 for a day with nothing scheduled on the press", () => {
    expect(hoursOnPressDay([], "Auto 1", "2026-06-04")).toBe(0);
  });
  it("ignores orders on other presses", () => {
    const orders = [o(1, "Manual A", "2026-06-04", null, 8)];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-04")).toBe(0);
  });
  it("ignores orders without estimated_hours", () => {
    const orders = [o(1, "Auto 1", "2026-06-04", null, 0)];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-04")).toBe(0);
  });
  it("returns full hours for a single-day order", () => {
    const orders = [o(1, "Auto 1", "2026-06-04", null, 6)];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-04")).toBe(6);
  });
  it("splits hours evenly across a multi-day span", () => {
    // 16 hours over 2 days → 8 hrs / day
    const orders = [o(1, "Auto 1", "2026-06-04", "2026-06-05", 16)];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-04")).toBe(8);
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-05")).toBe(8);
  });
  it("returns 0 for days outside the order's span", () => {
    const orders = [o(1, "Auto 1", "2026-06-04", "2026-06-05", 16)];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-03")).toBe(0);
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-06")).toBe(0);
  });
  it("sums multiple orders running on the same day", () => {
    // o1: 4h single-day, o2: 8h over 2 days → 4h/day contribution
    const orders = [
      o(1, "Auto 1", "2026-06-04", null, 4),
      o(2, "Auto 1", "2026-06-04", "2026-06-05", 8),
    ];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-04")).toBe(8);
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-05")).toBe(4);
  });
  it("rounds to 1 decimal place to keep the badge readable", () => {
    // 1 hour over 3 days = 0.333... → 0.3
    const orders = [o(1, "Auto 1", "2026-06-04", "2026-06-06", 1)];
    expect(hoursOnPressDay(orders, "Auto 1", "2026-06-04")).toBe(0.3);
  });
});
