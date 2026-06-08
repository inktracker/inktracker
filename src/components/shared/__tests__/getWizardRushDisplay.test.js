// Contract test for getWizardRushDisplay — the helper the public
// wizard uses to derive its "Rush ships in ${daysLabel} for an R%
// surcharge" copy from the shop's Rush Surcharge Tiers.
//
// Joe's rules:
//   1. No derivation. The wizard mirrors what the shop set in the
//      Rush Surcharge Tiers table.
//   2. The day label reads naturally as marketing copy:
//      - Single tier:  "14 business days or less"
//      - Multi-tier:   "7-14 business days"  (loosest tier; low bound
//                                              is the next tighter tier)
//   3. Rate = the LOOSEST tier's rate. Multi-tier shops keep their
//      urgent tier as a pricing override, not a wizard advertisement.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopPricingConfig,
  getWizardRushDisplay,
} from "@/components/shared/pricing";

beforeEach(() => loadShopPricingConfig(null));

describe("getWizardRushDisplay — fallback when no shop config", () => {
  it("returns the legacy single-rate defaults with 'or less' wording", () => {
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "5 business days or less",
      rate: 0.20,
    });
  });
});

describe("getWizardRushDisplay — single rush tier", () => {
  it("formats the loosest (only) tier as 'X business days or less'", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 15,
      rushTiers: [{ maxDays: 14, rate: 0.20 }],
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "14 business days or less",
      rate: 0.20,
    });
  });

  it("preserves whatever the shop typed — no off-by-one", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 10,
      rushTiers: [{ maxDays: 5, rate: 0.30 }],
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "5 business days or less",
      rate: 0.30,
    });
  });
});

describe("getWizardRushDisplay — multiple rush tiers", () => {
  it("formats the loosest tier as 'tighter-loosest business days'", () => {
    // Two tiers: 3 days → 50% (urgent), 14 days → 20% (moderate).
    // The wizard advertises the moderate tier — that covers days
    // 3-14 (orders faster than 3 days hit the urgent rate instead).
    loadShopPricingConfig({
      standardTurnaroundDays: 20,
      rushTiers: [
        { maxDays: 3, rate: 0.50 },
        { maxDays: 14, rate: 0.20 },
      ],
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "3-14 business days",
      rate: 0.20,
    });
  });

  it("uses only the next-tighter tier as the low bound, not the smallest", () => {
    // Three tiers: 3 / 7 / 14 days. The loosest is 14 days; the
    // NEXT tier down is 7 days. Wizard advertises "7-14 business
    // days", not "3-14".
    loadShopPricingConfig({
      standardTurnaroundDays: 20,
      rushTiers: [
        { maxDays: 3,  rate: 0.50 },
        { maxDays: 7,  rate: 0.30 },
        { maxDays: 14, rate: 0.15 },
      ],
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "7-14 business days",
      rate: 0.15,
    });
  });
});

describe("getWizardRushDisplay — fallback to legacy rushTurnaroundDays", () => {
  it("uses the legacy field when no tiers are configured", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushTurnaroundDays: 7,
      rushRate: 0.30,
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "7 business days or less",
      rate: 0.30,
    });
  });

  it("falls back when rushTiers exists but is an empty array", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushTiers: [],
      rushRate: 0.25,
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "5 business days or less",
      rate: 0.25,
    });
  });
});

describe("getWizardRushDisplay — Biota Mfg's live config (regression pin)", () => {
  // Pulled from prod 2026-06-08: std=15, single tier {maxDays:14, rate:0.20}.
  // Wizard should now read:
  //   "Standard ships in ~15 business days.
  //    Rush ships in 14 business days or less for a 20% surcharge."
  it("yields '14 business days or less' at 20% for the live Biota config", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 15,
      rushTiers: [{ maxDays: 14, rate: 0.20 }],
    });
    expect(getWizardRushDisplay()).toEqual({
      daysLabel: "14 business days or less",
      rate: 0.20,
    });
  });
});
