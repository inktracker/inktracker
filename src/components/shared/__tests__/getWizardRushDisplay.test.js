// Contract test for getWizardRushDisplay — the helper the public
// wizard uses to derive its "Rush ships in ~D days for R% surcharge"
// copy from whatever the shop has configured in Account → Pricing.
//
// Bug history: the wizard hardcoded 14/7/20% until 2026-06-08. PR #350
// wired the labels to read `pricing_config`, but there was no UI for
// `rushTurnaroundDays` — and we tried to add one (PR #353), which Joe
// rejected because rush information already lives in the Rush
// Surcharge Tiers table. The wizard should derive its display from
// that table, not add a parallel field.
//
// This test pins the derivation rules so future refactors can't shift
// them silently:
//
//   - Standard turnaround comes straight from pricing_config (already
//     covered by existing helpers).
//   - Rush rate = the LOOSEST tier's rate (largest maxDays). The
//     urgent tier doesn't apply unless a customer asks for an urgent
//     timeline, so the wizard advertises the moderate one.
//   - Rush days = half of standard, rounded down, minimum 1. Industry
//     convention; intentionally derived, not configurable.
//   - Cleanly falls back to getShopRushRate() and half-of-standard
//     when no tiers are set.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopPricingConfig,
  getWizardRushDisplay,
} from "@/components/shared/pricing";

beforeEach(() => loadShopPricingConfig(null));

describe("getWizardRushDisplay — fallback when no shop config", () => {
  it("returns platform defaults (5 days, 0.20 rate) on null config", () => {
    const { days, rate } = getWizardRushDisplay();
    // Standard default = 10; half = 5; rate falls back to 0.20.
    expect(days).toBe(5);
    expect(rate).toBe(0.20);
  });
});

describe("getWizardRushDisplay — derivation from standardTurnaroundDays", () => {
  it("rush days = floor(standard / 2)", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 14 });
    expect(getWizardRushDisplay().days).toBe(7);
  });

  it("rush days never goes below 1, even for very short standards", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 1 });
    expect(getWizardRushDisplay().days).toBe(1);
  });

  it("rounds down (15 / 2 = 7.5 → 7)", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 15 });
    expect(getWizardRushDisplay().days).toBe(7);
  });

  it("respects a custom long standard (30 → 15)", () => {
    loadShopPricingConfig({ standardTurnaroundDays: 30 });
    expect(getWizardRushDisplay().days).toBe(15);
  });
});

describe("getWizardRushDisplay — rate from rush tiers", () => {
  it("uses the loosest tier's rate when multiple are configured", () => {
    // Multi-tier: urgent (3 days → 50%), moderate (7 days → 25%). The
    // wizard should advertise the moderate one because that's what a
    // customer hits when they click Rush without specifying an urgent
    // timeline.
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushTiers: [
        { maxDays: 3, rate: 0.50 },
        { maxDays: 7, rate: 0.25 },
      ],
    });
    expect(getWizardRushDisplay().rate).toBe(0.25);
  });

  it("uses the single tier's rate when only one is configured", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 15,
      rushTiers: [{ maxDays: 15, rate: 0.20 }],
    });
    expect(getWizardRushDisplay().rate).toBe(0.20);
  });

  it("falls back to legacy rushRate when no tiers are set", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushRate: 0.30,
    });
    expect(getWizardRushDisplay().rate).toBe(0.30);
  });
});

describe("getWizardRushDisplay — Biota Mfg's actual config (regression pin)", () => {
  // Pulled from prod 2026-06-08: standardTurnaroundDays=15,
  // rushTiers=[{maxDays:15, rate:0.20}]. After this fix, the wizard
  // should show "Standard ships in ~15 business days. Rush ships in
  // ~7 business days for a 20% surcharge."
  it("derives 7 days at 20% for the live Biota config", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 15,
      rushTiers: [{ maxDays: 15, rate: 0.20 }],
    });
    const { days, rate } = getWizardRushDisplay();
    expect(days).toBe(7);
    expect(rate).toBe(0.20);
  });
});
