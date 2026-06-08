// Contract test for getWizardRushDisplay — the helper the public
// wizard uses to derive its "Rush ships in ~D days for R% surcharge"
// copy from whatever the shop has configured in Account → Pricing.
//
// Joe's rule, locked in 2026-06-08: the wizard mirrors the shop's
// rush tier table directly. No derivation, no extra knobs. If the
// shop sets a tier maxDays of 15 → the wizard shows 15. Want a
// different number? Change the tier.

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadShopPricingConfig,
  getWizardRushDisplay,
} from "@/components/shared/pricing";

beforeEach(() => loadShopPricingConfig(null));

describe("getWizardRushDisplay — fallback when no shop config", () => {
  it("returns platform defaults on null config", () => {
    const { days, rate } = getWizardRushDisplay();
    expect(days).toBe(5);    // DEFAULT_RUSH_TURNAROUND_DAYS
    expect(rate).toBe(0.20); // legacy rushRate default
  });
});

describe("getWizardRushDisplay — derivation from rush tiers", () => {
  it("uses the loosest tier's maxDays + rate directly when one tier is set", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 15,
      rushTiers: [{ maxDays: 15, rate: 0.20 }],
    });
    expect(getWizardRushDisplay()).toEqual({ days: 15, rate: 0.20 });
  });

  it("picks the LOOSEST tier (largest maxDays) when multiple are set", () => {
    // Multi-tier: urgent 3 days → 50%, moderate 7 days → 25%.
    // Wizard advertises the moderate (loosest) tier; the urgent rate
    // is a pricing override that only kicks in when a customer asks
    // for a sub-3-day due date.
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushTiers: [
        { maxDays: 3, rate: 0.50 },
        { maxDays: 7, rate: 0.25 },
      ],
    });
    expect(getWizardRushDisplay()).toEqual({ days: 7, rate: 0.25 });
  });

  it("uses the tier values verbatim — no /2, no -1, no derivation", () => {
    // Pins the contract: whatever the shop typed is what the wizard
    // shows. Regression guard against re-introducing the floor(std/2)
    // derivation that was tried 2026-06-08 and rejected.
    loadShopPricingConfig({
      standardTurnaroundDays: 20,
      rushTiers: [{ maxDays: 10, rate: 0.30 }],
    });
    expect(getWizardRushDisplay()).toEqual({ days: 10, rate: 0.30 });
  });
});

describe("getWizardRushDisplay — fallback to legacy single-rate fields", () => {
  it("falls back to rushTurnaroundDays + rushRate when no tiers are set", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushTurnaroundDays: 7,
      rushRate: 0.30,
    });
    expect(getWizardRushDisplay()).toEqual({ days: 7, rate: 0.30 });
  });

  it("still falls back when rushTiers exists but is empty array", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 14,
      rushTiers: [],
      rushRate: 0.25,
    });
    expect(getWizardRushDisplay()).toEqual({ days: 5, rate: 0.25 });
  });
});

describe("getWizardRushDisplay — Biota Mfg's actual config (regression pin)", () => {
  // Pulled from prod 2026-06-08: standardTurnaroundDays=15,
  // rushTiers=[{maxDays:15, rate:0.20}]. Wizard should show:
  //   "Standard ships in ~15 business days.
  //    Rush ships in ~15 business days for a 20% surcharge."
  // If that reads weirdly to a customer (rush = standard), the fix
  // is on Joe's side — tighten the rush tier maxDays.
  it("derives 15 days at 20% for the live Biota config", () => {
    loadShopPricingConfig({
      standardTurnaroundDays: 15,
      rushTiers: [{ maxDays: 15, rate: 0.20 }],
    });
    expect(getWizardRushDisplay()).toEqual({ days: 15, rate: 0.20 });
  });
});
