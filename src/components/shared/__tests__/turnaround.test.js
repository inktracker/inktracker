// Turnaround + rush-rate config helpers. The QuoteEditorModal +
// BrokerQuoteEditor read these every time the modal opens — wrong
// values change the default due date on every new quote, so the
// behavior is pinned here.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopPricingConfig,
  getStandardTurnaroundDays,
  getRushTurnaroundDays,
  getShopRushRate,
  DEFAULT_STANDARD_TURNAROUND_DAYS,
  DEFAULT_RUSH_TURNAROUND_DAYS,
} from "../pricing";

beforeEach(() => loadShopPricingConfig(null));

describe("getStandardTurnaroundDays", () => {
  it("falls back to the platform default (10) when no config is loaded", () => {
    expect(getStandardTurnaroundDays()).toBe(DEFAULT_STANDARD_TURNAROUND_DAYS);
    expect(getStandardTurnaroundDays()).toBe(10);
  });

  it("uses the shop's value when configured", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 14 });
    expect(getStandardTurnaroundDays()).toBe(14);
  });

  it("coerces numeric strings", () => {
    loadShopPricingConfig({ standardTurnaroundDays: "21" });
    expect(getStandardTurnaroundDays()).toBe(21);
  });

  it("rounds fractional values to the nearest integer", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 7.4 });
    expect(getStandardTurnaroundDays()).toBe(7);
    loadShopPricingConfig({ standardTurnaroundDays: 7.6 });
    expect(getStandardTurnaroundDays()).toBe(8);
  });

  it("rejects zero / negative / non-finite — falls back to default", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 0 });
    expect(getStandardTurnaroundDays()).toBe(10);
    loadShopPricingConfig({ standardTurnaroundDays: -5 });
    expect(getStandardTurnaroundDays()).toBe(10);
    loadShopPricingConfig({ standardTurnaroundDays: NaN });
    expect(getStandardTurnaroundDays()).toBe(10);
    loadShopPricingConfig({ standardTurnaroundDays: "abc" });
    expect(getStandardTurnaroundDays()).toBe(10);
  });
});

describe("getRushTurnaroundDays", () => {
  it("falls back to the platform default (5) when no config is loaded", () => {
    expect(getRushTurnaroundDays()).toBe(DEFAULT_RUSH_TURNAROUND_DAYS);
    expect(getRushTurnaroundDays()).toBe(5);
  });

  it("uses the shop's value when configured", () => {
    loadShopPricingConfig({ rushTurnaroundDays: 3 });
    expect(getRushTurnaroundDays()).toBe(3);
  });

  it("can be set INDEPENDENTLY of the standard turnaround", () => {
    // The two fields aren't constrained relative to each other — a
    // shop could legitimately set rush == standard for the platform
    // to nudge them toward charging the rush fee on everything.
    loadShopPricingConfig({ standardTurnaroundDays: 7, rushTurnaroundDays: 7 });
    expect(getStandardTurnaroundDays()).toBe(7);
    expect(getRushTurnaroundDays()).toBe(7);
  });

  it("rejects zero / negative — falls back", () => {
    loadShopPricingConfig({ rushTurnaroundDays: 0 });
    expect(getRushTurnaroundDays()).toBe(5);
  });
});

describe("getShopRushRate", () => {
  it("falls back to the platform default 0.20 when not set", () => {
    expect(getShopRushRate()).toBe(0.2);
  });

  it("uses the shop's configured rate", () => {
    loadShopPricingConfig({ rushRate: 0.35 });
    expect(getShopRushRate()).toBe(0.35);
  });

  it("accepts 0 (means 'no rush surcharge' for shops that don't charge one)", () => {
    loadShopPricingConfig({ rushRate: 0 });
    expect(getShopRushRate()).toBe(0);
  });

  it("falls back when the configured value is invalid", () => {
    loadShopPricingConfig({ rushRate: NaN });
    expect(getShopRushRate()).toBe(0.2);
    loadShopPricingConfig({ rushRate: -0.5 });
    expect(getShopRushRate()).toBe(0.2);
    loadShopPricingConfig({ rushRate: "abc" });
    expect(getShopRushRate()).toBe(0.2);
  });
});
