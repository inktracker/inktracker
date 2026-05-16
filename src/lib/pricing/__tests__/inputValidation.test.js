import { describe, it, expect } from "vitest";
import {
  parsePricingNumber,
  validateMoney,
  validateMarkup,
  validateTaxRate,
  validateTierQty,
  validatePricingConfig,
} from "../inputValidation.js";

// ─────────────────────────────────────────────────────────────────────
// parsePricingNumber — the base validator
// ─────────────────────────────────────────────────────────────────────

describe("parsePricingNumber — accepts valid numbers", () => {
  it("PN1 — integer string", () => {
    expect(parsePricingNumber("5", { label: "X" })).toEqual({ ok: true, value: 5 });
  });
  it("PN2 — decimal string", () => {
    expect(parsePricingNumber("5.25", { label: "X" })).toEqual({ ok: true, value: 5.25 });
  });
  it("PN3 — plain number input", () => {
    expect(parsePricingNumber(5.25, { label: "X" })).toEqual({ ok: true, value: 5.25 });
  });
  it("PN4 — zero is valid by default (min defaults to 0)", () => {
    expect(parsePricingNumber("0", { label: "X" })).toEqual({ ok: true, value: 0 });
  });
  it("PN5 — leading/trailing whitespace trimmed", () => {
    expect(parsePricingNumber("  5.25  ", { label: "X" })).toEqual({ ok: true, value: 5.25 });
  });
});

describe("parsePricingNumber — rejects bad input with helpful message", () => {
  it("PN6 — letters (the canonical case Joe asked about)", () => {
    const r = parsePricingNumber("abc", { label: "Tax rate" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Tax rate/);
    expect(r.error).toMatch(/must be a number/);
    expect(r.error).toMatch(/abc/); // user sees what they typed
  });

  it("PN7 — symbols like $ % ,", () => {
    expect(parsePricingNumber("$5.25", { label: "Price" }).ok).toBe(false);
    expect(parsePricingNumber("5%",    { label: "Rate" }).ok).toBe(false);
    expect(parsePricingNumber("5,000", { label: "Tier" }).ok).toBe(false);
  });

  it("PN8 — mixed garbage (parseFloat would partially parse)", () => {
    // parseFloat("3.14.15") returns 3.14 silently — STRICT_NUMERIC rejects.
    expect(parsePricingNumber("3.14.15", { label: "X" }).ok).toBe(false);
    // parseFloat("5abc") returns 5 silently — also rejected.
    expect(parsePricingNumber("5abc",    { label: "X" }).ok).toBe(false);
  });

  it("PN9 — scientific notation (silent multiplier)", () => {
    // parseFloat("5e10") returns 50000000000. A typo for "5" that
    // would otherwise destroy the shop's pricing chart.
    expect(parsePricingNumber("5e10", { label: "Price" }).ok).toBe(false);
  });

  it("PN10 — empty string", () => {
    const r = parsePricingNumber("", { label: "Markup" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/can't be empty/);
  });

  it("PN11 — empty allowed with allowEmpty flag → ok with value: undefined", () => {
    expect(parsePricingNumber("", { label: "X", allowEmpty: true }))
      .toEqual({ ok: true, value: undefined });
  });

  it("PN12 — pure whitespace", () => {
    expect(parsePricingNumber("   ", { label: "X" }).ok).toBe(false);
  });

  it("PN13 — null / undefined", () => {
    expect(parsePricingNumber(null, { label: "X" }).ok).toBe(false);
    expect(parsePricingNumber(undefined, { label: "X" }).ok).toBe(false);
  });

  it("PN14 — NaN input (e.g. broken upstream calc)", () => {
    expect(parsePricingNumber(NaN, { label: "X" }).ok).toBe(false);
  });
});

describe("parsePricingNumber — range checks", () => {
  it("PN15 — below min", () => {
    const r = parsePricingNumber("-1", { label: "Price", min: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least 0/);
  });

  it("PN16 — above max", () => {
    const r = parsePricingNumber("150", { label: "Tax rate", min: 0, max: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/can't exceed 100/);
  });

  it("PN17 — exactly at min and max boundaries (inclusive)", () => {
    expect(parsePricingNumber("0",   { label: "X", min: 0, max: 100 }).ok).toBe(true);
    expect(parsePricingNumber("100", { label: "X", min: 0, max: 100 }).ok).toBe(true);
  });
});

describe("parsePricingNumber — integer flag", () => {
  it("PN18 — integer required, decimal rejected", () => {
    const r = parsePricingNumber("25.5", { label: "Tier qty", integer: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/whole number/);
  });

  it("PN19 — integer required, integer accepted", () => {
    expect(parsePricingNumber("25", { label: "Tier qty", integer: true }).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Field-specific shortcuts
// ─────────────────────────────────────────────────────────────────────

describe("validateMoney / Markup / TaxRate / TierQty", () => {
  it("FS1 — validateMoney rejects negative (no negative prices)", () => {
    expect(validateMoney("-5", "Price").ok).toBe(false);
  });

  it("FS2 — validateMarkup rejects < 1 (selling below cost is almost never intentional)", () => {
    expect(validateMarkup("0.5", "Markup").ok).toBe(false);
    expect(validateMarkup("1.5", "Markup")).toEqual({ ok: true, value: 1.5 });
  });

  it("FS3 — validateTaxRate clamps to 0..100", () => {
    expect(validateTaxRate("-5",  "Tax").ok).toBe(false);
    expect(validateTaxRate("150", "Tax").ok).toBe(false);
    expect(validateTaxRate("8.25", "Tax")).toEqual({ ok: true, value: 8.25 });
  });

  it("FS4 — validateTierQty rejects decimals (tiers are integer qtys)", () => {
    expect(validateTierQty("25.5", "Tier").ok).toBe(false);
    expect(validateTierQty("25",   "Tier")).toEqual({ ok: true, value: 25 });
  });

  it("FS5 — validateTierQty rejects 0 (no tier-0 pricing meaningful)", () => {
    expect(validateTierQty("0", "Tier").ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// validatePricingConfig — full-config walker
// ─────────────────────────────────────────────────────────────────────

describe("validatePricingConfig — happy path", () => {
  it("VC1 — empty config returns no errors", () => {
    expect(validatePricingConfig({})).toEqual([]);
    expect(validatePricingConfig(null)).toEqual([]);
  });

  it("VC2 — fully-valid config returns no errors", () => {
    expect(validatePricingConfig({
      tiers: [25, 50, 100, 200],
      firstPrint: { 1: { 25: 6.30, 50: 5.67 } },
      addlPrint:  { 1: { 25: 3.15, 50: 2.68 } },
      garmentMarkup: [{ above: 0, markup: 1.4 }],
      extras: { colorMatch: 1.0 },
    })).toEqual([]);
  });
});

describe("validatePricingConfig — catches each invalid surface", () => {
  it("VC3 — bad tier qty (the canonical case)", () => {
    const errors = validatePricingConfig({ tiers: [25, "abc", 100] });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Tier #2.*must be a number.*abc/);
  });

  it("VC4 — bad firstPrint entry surfaces with full path in label", () => {
    const errors = validatePricingConfig({
      firstPrint: { 2: { 100: "abc" } },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/First print.*2 color.*100 pcs/);
  });

  it("VC5 — multiple bad fields → multiple errors", () => {
    const errors = validatePricingConfig({
      tiers: ["bad1", 50, "bad2"],
      extras: { colorMatch: "ugly" },
    });
    expect(errors.length).toBe(3);
  });

  it("VC6 — bad markup < 1 caught", () => {
    const errors = validatePricingConfig({
      garmentMarkup: [{ above: 0, markup: 0.5 }],
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Garment markup/);
  });

  it("VC7 — bad embroidery qty tier caught", () => {
    const errors = validatePricingConfig({
      embroidery: { qtyTiers: [12, "garbage", 48] },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Embroidery qty tier #2/);
  });

  it("VC8 — bad embroidery price caught", () => {
    const errors = validatePricingConfig({
      embroidery: {
        pricing: { "Under 5K": { 12: "$8.50" } },
      },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/Embroidery "Under 5K" × 12 pcs/);
  });

  it("VC9 — partially-valid config flags only the bad parts", () => {
    const errors = validatePricingConfig({
      tiers: [25, 50, 100],                              // ok
      firstPrint: { 1: { 25: 6.30, 50: "broken" } },    // 1 error
      addlPrint:  { 1: { 25: 3.15, 50: 2.68 } },        // ok
      garmentMarkup: [{ above: 0, markup: 1.4 }],       // ok
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/First print.*1 color.*50 pcs/);
  });
});
