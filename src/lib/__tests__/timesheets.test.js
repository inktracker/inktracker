import { describe, it, expect } from "vitest";
import { entryMinutes, sumMinutes, fmtDuration, weekRange } from "../timesheets";

describe("entryMinutes", () => {
  it("prefers the stored minutes over the clocks", () => {
    expect(entryMinutes({ minutes: 90, clock_in: "2026-08-24T09:00:00Z", clock_out: "2026-08-24T10:00:00Z" })).toBe(90);
  });

  it("derives from clock_in/clock_out when minutes is unset", () => {
    expect(entryMinutes({ minutes: null, clock_in: "2026-08-24T09:00:00Z", clock_out: "2026-08-24T17:30:00Z" })).toBe(510);
  });

  it("uses `now` for a still-open entry", () => {
    const nowMs = new Date("2026-08-24T09:45:00Z").getTime();
    expect(entryMinutes({ minutes: null, clock_in: "2026-08-24T09:00:00Z" }, nowMs)).toBe(45);
  });

  it("returns 0 for garbage: null entry, missing clock_in, negative spans", () => {
    expect(entryMinutes(null)).toBe(0);
    expect(entryMinutes({ minutes: null })).toBe(0);
    expect(entryMinutes({ minutes: null, clock_in: "2026-08-24T10:00:00Z", clock_out: "2026-08-24T09:00:00Z" })).toBe(0);
    expect(entryMinutes({ minutes: -30 })).toBe(0);
  });
});

describe("sumMinutes / fmtDuration", () => {
  it("sums entries and formats hours + zero-padded minutes", () => {
    const total = sumMinutes([{ minutes: 480 }, { minutes: 65 }, null]);
    expect(total).toBe(545);
    expect(fmtDuration(total)).toBe("9h 05m");
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(0)).toBe("0m");
  });
});

describe("weekRange", () => {
  it("anchors Monday–Sunday around any weekday", () => {
    // 2026-08-26 is a Wednesday
    expect(weekRange("2026-08-26")).toEqual({ start: "2026-08-24", end: "2026-08-30" });
  });

  it("keeps a Sunday inside the week that started the prior Monday", () => {
    expect(weekRange("2026-08-30")).toEqual({ start: "2026-08-24", end: "2026-08-30" });
  });

  it("handles month boundaries", () => {
    expect(weekRange("2026-09-01")).toEqual({ start: "2026-08-31", end: "2026-09-06" });
  });
});
