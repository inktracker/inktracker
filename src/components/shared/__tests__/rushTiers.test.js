// Variable rush surcharge tier table. The quote modal calls
// getRushRateForDaysOut(daysOut) every time the due date changes —
// these contract tests pin tier ordering, gap behavior, and the
// legacy single-rate fallback so shops that never migrate from
// the old {rushRate, rushTurnaroundDays} pair keep working.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopPricingConfig,
  getRushTiers,
  getRushRateForDaysOut,
} from "../pricing";

beforeEach(() => loadShopPricingConfig(null));

describe("getRushTiers — shop-side normalization", () => {
  it("returns [] when no tiers and no legacy rate are configured", () => {
    expect(getRushTiers()).toEqual([]);
  });

  it("sorts tiers ascending by maxDays", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [
        { maxDays: 8, rate: 0.25 },
        { maxDays: 3, rate: 0.50 },
        { maxDays: 5, rate: 0.35 },
      ],
    });
    expect(getRushTiers().map(t => t.maxDays)).toEqual([3, 5, 8]);
  });

  it("rounds fractional maxDays values", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [{ maxDays: 3.4, rate: 0.5 }, { maxDays: 5.6, rate: 0.25 }],
    });
    expect(getRushTiers().map(t => t.maxDays)).toEqual([3, 6]);
  });

  it("drops tiers with non-finite / negative rate or maxDays", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [
        { maxDays: 0, rate: 0.5 },          // invalid: maxDays 0
        { maxDays: -3, rate: 0.5 },         // invalid: negative
        { maxDays: NaN, rate: 0.5 },        // invalid: NaN
        { maxDays: 3, rate: -0.1 },         // invalid: negative rate
        { maxDays: 3, rate: NaN },          // invalid: NaN rate
        { maxDays: 5, rate: 0.25 },         // ok
      ],
    });
    expect(getRushTiers()).toEqual([{ maxDays: 5, rate: 0.25 }]);
  });

  it("drops tiers whose maxDays exceeds the standard turnaround", () => {
    // A tier saying "if due in less than 20 days" makes no sense
    // for a shop whose standard turnaround is 10 days — anything
    // that close already qualifies as standard. Strip it on read.
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [
        { maxDays: 5,  rate: 0.50 },
        { maxDays: 10, rate: 0.20 }, // boundary: kept (< standard ok)
        { maxDays: 15, rate: 0.10 }, // out of range — dropped
      ],
    });
    expect(getRushTiers().map(t => t.maxDays)).toEqual([5, 10]);
  });

  it("accepts a rate of 0 (means 'no upcharge, but still rush priority')", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [{ maxDays: 7, rate: 0 }],
    });
    expect(getRushTiers()).toEqual([{ maxDays: 7, rate: 0 }]);
  });
});

describe("getRushTiers — legacy single-rate fallback", () => {
  // Shops on the previous {rushRate, rushTurnaroundDays} model
  // should keep seeing rush surcharge until they migrate to the
  // tier table. The synthesized tier matches the legacy semantics
  // exactly: "if due in less than rushTurnaroundDays, charge
  // rushRate."
  it("synthesizes a single tier from legacy rushRate + rushTurnaroundDays", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTurnaroundDays: 5,
      rushRate: 0.20,
    });
    expect(getRushTiers()).toEqual([{ maxDays: 5, rate: 0.20 }]);
  });

  it("prefers the tier table over the legacy fields when both are present", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTurnaroundDays: 5,
      rushRate: 0.20,
      rushTiers: [{ maxDays: 3, rate: 0.50 }],
    });
    expect(getRushTiers()).toEqual([{ maxDays: 3, rate: 0.50 }]);
  });

  it("skips the legacy fallback when legacy rate is 0 / missing", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 10, rushRate: 0 });
    expect(getRushTiers()).toEqual([]);
  });
});

describe("getRushRateForDaysOut — picks the tightest matching tier", () => {
  beforeEach(() => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [
        { maxDays: 3, rate: 0.50 },   // <3 days = +50%
        { maxDays: 6, rate: 0.25 },   // <6 days = +25%
        { maxDays: 9, rate: 0.10 },   // <9 days = +10%
      ],
    });
  });

  it("returns the tightest tier rate when daysOut is below it", () => {
    expect(getRushRateForDaysOut(1)).toBe(0.50);
    expect(getRushRateForDaysOut(2)).toBe(0.50);
  });

  it("slides up to the looser tier as daysOut grows", () => {
    expect(getRushRateForDaysOut(3)).toBe(0.25);
    expect(getRushRateForDaysOut(5)).toBe(0.25);
  });

  it("uses the loosest tier when daysOut is just below standard", () => {
    expect(getRushRateForDaysOut(6)).toBe(0.10);
    expect(getRushRateForDaysOut(8)).toBe(0.10);
  });

  it("returns 0 at and above the standard turnaround", () => {
    expect(getRushRateForDaysOut(9)).toBe(0); // no tier covers >= 9 below standard
    expect(getRushRateForDaysOut(10)).toBe(0);
    expect(getRushRateForDaysOut(20)).toBe(0);
  });

  it("returns 0 for non-finite input (defensive)", () => {
    expect(getRushRateForDaysOut(NaN)).toBe(0);
    expect(getRushRateForDaysOut(undefined)).toBe(0);
    expect(getRushRateForDaysOut(null)).toBe(0);
    expect(getRushRateForDaysOut("abc")).toBe(0);
  });

  it("falls back to legacy single-rate when no tier table exists", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTurnaroundDays: 5,
      rushRate: 0.20,
    });
    expect(getRushRateForDaysOut(2)).toBe(0.20); // legacy single rate
    expect(getRushRateForDaysOut(5)).toBe(0);    // at legacy max — no rush
    expect(getRushRateForDaysOut(10)).toBe(0);   // at standard — no rush
  });

  it("returns 0 when no tiers and no legacy rate are configured", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 10 });
    expect(getRushRateForDaysOut(2)).toBe(0);
  });
});
