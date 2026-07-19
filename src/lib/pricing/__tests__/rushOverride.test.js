import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  quoteDaysOut,
  isRushManuallyOverridden,
  nextRushRateForDueDateChange,
} from "../rushOverride";
import { loadShopPricingConfig } from "@/components/shared/pricing";

// Shop with a 10-day standard turnaround and two rush cliffs:
// under 3 days = +50%, under 6 days = +25%.
const CONFIG = {
  standardTurnaroundDays: 10,
  rushTiers: [
    { maxDays: 3, rate: 0.5 },
    { maxDays: 6, rate: 0.25 },
  ],
};

beforeEach(() => loadShopPricingConfig(CONFIG, "shop@x.test"));
afterEach(() => loadShopPricingConfig(null));

describe("quoteDaysOut", () => {
  it("returns calendar days between quote date and due date", () => {
    expect(quoteDaysOut({ date: "2026-07-01", due_date: "2026-07-05" })).toBe(4);
  });

  it("returns null when either date is missing or invalid", () => {
    expect(quoteDaysOut({ date: "", due_date: "2026-07-05" })).toBeNull();
    expect(quoteDaysOut({ date: "2026-07-01", due_date: "" })).toBeNull();
    expect(quoteDaysOut({ date: "garbage", due_date: "2026-07-05" })).toBeNull();
    expect(quoteDaysOut(null)).toBeNull();
  });
});

describe("isRushManuallyOverridden", () => {
  it("false when the stored rate matches what the tier table auto-applies", () => {
    // 4 days out → +50%? No: under-6 cliff → +25%.
    const q = { date: "2026-07-01", due_date: "2026-07-05", rush_rate: 0.25 };
    expect(isRushManuallyOverridden(q)).toBe(false);
  });

  it("true for a waived rush on a tight due date (the tester's scenario)", () => {
    const q = { date: "2026-07-01", due_date: "2026-07-05", rush_rate: 0 };
    expect(isRushManuallyOverridden(q)).toBe(true);
  });

  it("true when the operator picked a different tier than the table suggests", () => {
    const q = { date: "2026-07-01", due_date: "2026-07-05", rush_rate: 0.5 };
    expect(isRushManuallyOverridden(q)).toBe(true);
  });

  it("false for a standard-turnaround quote with no rush", () => {
    const q = { date: "2026-07-01", due_date: "2026-07-20", rush_rate: 0 };
    expect(isRushManuallyOverridden(q)).toBe(false);
  });

  it("false when dates are missing (can't judge — don't seed the flag)", () => {
    expect(isRushManuallyOverridden({ rush_rate: 0 })).toBe(false);
  });
});

describe("nextRushRateForDueDateChange", () => {
  it("auto-follows the tier table by default (rate follows the date)", () => {
    expect(nextRushRateForDueDateChange({ diffDays: 2, currentRate: 0, rushManuallySet: false })).toBe(0.5);
    expect(nextRushRateForDueDateChange({ diffDays: 4, currentRate: 0.5, rushManuallySet: false })).toBe(0.25);
    expect(nextRushRateForDueDateChange({ diffDays: 15, currentRate: 0.25, rushManuallySet: false })).toBe(0);
  });

  it("a manual WAIVE sticks: rate stays 0 across due-date changes", () => {
    expect(nextRushRateForDueDateChange({ diffDays: 2, currentRate: 0, rushManuallySet: true })).toBe(0);
    expect(nextRushRateForDueDateChange({ diffDays: 4, currentRate: "0", rushManuallySet: true })).toBe(0);
  });

  it("a manually picked NONZERO tier still follows date slides (only the waive is sticky)", () => {
    expect(nextRushRateForDueDateChange({ diffDays: 15, currentRate: 0.5, rushManuallySet: true })).toBe(0);
    expect(nextRushRateForDueDateChange({ diffDays: 4, currentRate: 0.5, rushManuallySet: true })).toBe(0.25);
  });

  it("null diffDays keeps the current rate", () => {
    expect(nextRushRateForDueDateChange({ diffDays: null, currentRate: 0.25, rushManuallySet: false })).toBe(0.25);
  });
});
