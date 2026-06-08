// Contract tests for the rush-tier maxDays clamp used in Account.jsx.
//
// Rules:
//   1. Never returns a value > standardTurnaroundDays (the cap).
//   2. Never returns a value < 1 (floor).
//   3. Returns an integer.
//   4. Hardens garbage input (NaN, empty string, negative, non-numeric)
//      down to 1 instead of crashing the React state setter.

import { describe, it, expect } from "vitest";
import {
  clampRushTierMaxDays,
  defaultNewRushTierMaxDays,
} from "../rushTierClamp.js";

describe("clampRushTierMaxDays — cap at standard turnaround", () => {
  it("returns the input unchanged when it's within bounds", () => {
    expect(clampRushTierMaxDays(7, 15)).toBe(7);
  });

  it("caps at the standard when the input exceeds it (the headline bug)", () => {
    expect(clampRushTierMaxDays(30, 15)).toBe(15);
  });

  it("allows input equal to the standard", () => {
    expect(clampRushTierMaxDays(15, 15)).toBe(15);
  });

  it("uses the platform default of 10 when standard is missing", () => {
    expect(clampRushTierMaxDays(20, undefined)).toBe(10);
    expect(clampRushTierMaxDays(20, null)).toBe(10);
    expect(clampRushTierMaxDays(20, 0)).toBe(10);
  });
});

describe("clampRushTierMaxDays — floor at 1", () => {
  it("clamps zero up to 1", () => {
    expect(clampRushTierMaxDays(0, 15)).toBe(1);
  });

  it("clamps negative input up to 1", () => {
    expect(clampRushTierMaxDays(-5, 15)).toBe(1);
  });
});

describe("clampRushTierMaxDays — garbage input", () => {
  it("returns 1 for NaN", () => {
    expect(clampRushTierMaxDays(NaN, 15)).toBe(1);
  });

  it("returns 1 for empty string", () => {
    expect(clampRushTierMaxDays("", 15)).toBe(1);
  });

  it("returns 1 for non-numeric string", () => {
    expect(clampRushTierMaxDays("abc", 15)).toBe(1);
  });

  it("rounds a decimal input", () => {
    expect(clampRushTierMaxDays(7.6, 15)).toBe(8);
    expect(clampRushTierMaxDays(7.4, 15)).toBe(7);
  });

  it("coerces a numeric string", () => {
    expect(clampRushTierMaxDays("14", 15)).toBe(14);
  });

  it("returns an integer regardless of input type", () => {
    const result = clampRushTierMaxDays(7.5, 15);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("defaultNewRushTierMaxDays — seed for + Add tier button", () => {
  it("returns 3 when no tiers exist yet", () => {
    expect(defaultNewRushTierMaxDays([], 15)).toBe(3);
  });

  it("returns loosest - 2 when at least one tier exists", () => {
    expect(defaultNewRushTierMaxDays([{ maxDays: 14, rate: 0.20 }], 20)).toBe(12);
  });

  it("uses the LOOSEST tier as the seed, not the tightest", () => {
    expect(defaultNewRushTierMaxDays(
      [{ maxDays: 3, rate: 0.50 }, { maxDays: 10, rate: 0.25 }],
      15,
    )).toBe(8);
  });

  it("caps the seed at the standard, even when loosest - 2 would exceed it", () => {
    // Standard is 10, loosest tier is 12 (which the cap allowed before
    // but the read filter dropped); seed would otherwise be 10. Same
    // as standard — passes the cap by ≤.
    expect(defaultNewRushTierMaxDays([{ maxDays: 12, rate: 0.20 }], 10)).toBe(10);
  });

  it("returns at minimum 1 when standard is 1", () => {
    expect(defaultNewRushTierMaxDays([], 1)).toBe(1);
  });

  it("ignores malformed existing tiers when looking for the loosest", () => {
    expect(defaultNewRushTierMaxDays(
      [{ maxDays: NaN }, { maxDays: -3 }, { maxDays: 7 }],
      15,
    )).toBe(5);
  });

  it("returns 3 when existingTiers is not an array", () => {
    expect(defaultNewRushTierMaxDays(null, 15)).toBe(3);
    expect(defaultNewRushTierMaxDays(undefined, 15)).toBe(3);
    expect(defaultNewRushTierMaxDays("oops", 15)).toBe(3);
  });
});
