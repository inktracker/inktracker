import { describe, it, expect } from "vitest";
import {
  getMonthKey,
  formatMonthLabel,
  buildMonthlyChart,
} from "../invoicesAggregation.js";

describe("getMonthKey", () => {
  it("extracts YYYY-MM from an ISO timestamp", () => {
    expect(getMonthKey("2026-05-14T22:30:00Z")).toBe("2026-05");
  });

  it("extracts YYYY-MM from a date-only string", () => {
    expect(getMonthKey("2026-12-31")).toBe("2026-12");
  });

  it("returns null on falsy / invalid input", () => {
    expect(getMonthKey(null)).toBe(null);
    expect(getMonthKey("")).toBe(null);
    expect(getMonthKey("not a date")).toBe(null);
    expect(getMonthKey("12/31/2026")).toBe(null);
  });
});

describe("formatMonthLabel", () => {
  it("formats key as 'Mon 'YY'", () => {
    expect(formatMonthLabel("2026-05")).toBe("May '26");
    expect(formatMonthLabel("2025-01")).toBe("Jan '25");
    expect(formatMonthLabel("2024-12")).toBe("Dec '24");
  });

  it("returns empty string on bad input rather than crashing", () => {
    expect(formatMonthLabel("")).toBe("");
    expect(formatMonthLabel(null)).toBe("");
    expect(formatMonthLabel("2026-13")).toBe(""); // invalid month
  });
});

describe("buildMonthlyChart", () => {
  const jobs = [
    { date: "2026-01-15", _brokerTotal: 100 },
    { date: "2026-01-25", _brokerTotal: 50 },
    { date: "2026-02-10", _brokerTotal: 200 },
    { date: "2026-03-05", _brokerTotal: 75 },
  ];

  it("groups by month, sums revenue and job count", () => {
    const out = buildMonthlyChart(jobs);
    expect(out).toEqual([
      { month: "2026-01", revenue: 150, jobs: 2, label: "Jan '26" },
      { month: "2026-02", revenue: 200, jobs: 1, label: "Feb '26" },
      { month: "2026-03", revenue: 75, jobs: 1, label: "Mar '26" },
    ]);
  });

  it("falls back to created_date when date is missing", () => {
    const out = buildMonthlyChart([
      { _brokerTotal: 50, created_date: "2026-04-01T00:00:00Z" },
    ]);
    expect(out).toEqual([
      { month: "2026-04", revenue: 50, jobs: 1, label: "Apr '26" },
    ]);
  });

  it("trims to the most recent 12 months when history is longer", () => {
    const longHistory = [];
    for (let y = 2024; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        longHistory.push({
          date: `${y}-${String(m).padStart(2, "0")}-01`,
          _brokerTotal: 100,
        });
      }
    }
    const out = buildMonthlyChart(longHistory);
    expect(out).toHaveLength(12);
    expect(out[0].month).toBe("2026-01"); // oldest of the trimmed 12
    expect(out[11].month).toBe("2026-12");
  });

  it("ignores jobs with no usable date", () => {
    const out = buildMonthlyChart([
      { _brokerTotal: 100 }, // no date
      { date: "broken", _brokerTotal: 50 },
      { date: "2026-05-01", _brokerTotal: 25 },
    ]);
    expect(out).toEqual([
      { month: "2026-05", revenue: 25, jobs: 1, label: "May '26" },
    ]);
  });

  it("handles missing _brokerTotal as 0", () => {
    const out = buildMonthlyChart([
      { date: "2026-05-01" }, // no _brokerTotal
      { date: "2026-05-02", _brokerTotal: 100 },
    ]);
    expect(out[0]).toEqual({ month: "2026-05", revenue: 100, jobs: 2, label: "May '26" });
  });

  it("returns empty array for null/undefined input", () => {
    expect(buildMonthlyChart(null)).toEqual([]);
    expect(buildMonthlyChart(undefined)).toEqual([]);
  });
});
