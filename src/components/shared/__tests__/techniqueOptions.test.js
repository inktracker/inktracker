// getTechniqueOptions — the technique dropdown options for a line that may
// ALREADY have a technique saved. Regression guard for the reported bug:
// a shop made an Embroidery quote, saved it, reopened to edit, and could no
// longer select Embroidery because the dropdown only listed currently-enabled
// techniques. The fix: always include the line's current technique.

import { describe, it, expect } from "vitest";
import { getTechniqueOptions } from "../pricing";

// A config with embroidery DISABLED (and no embroidery pricing table), to
// simulate stale/absent config or embroidery toggled off after save.
const NO_EMBROIDERY_CFG = {
  firstPrint: { 1: { 25: 6 } },
  addlPrint: { 1: { 25: 3 } },
  tiers: [25, 50, 100, 200],
  maxColors: 8,
  embroidery: { enabled: false },
};

const WITH_EMBROIDERY_CFG = {
  ...NO_EMBROIDERY_CFG,
  embroidery: { enabled: true, pricing: { "Under 5K": { 72: 5.75 } } },
};

describe("getTechniqueOptions", () => {
  it("includes the current technique even when the config doesn't enable it (the bug)", () => {
    // Embroidery is OFF in config, but the saved line already uses it.
    const opts = getTechniqueOptions("Embroidery", NO_EMBROIDERY_CFG);
    expect(opts).toContain("Embroidery");
    expect(opts).toContain("Screen Print"); // base technique always present
  });

  it("does not duplicate the current technique when the config already enables it", () => {
    const opts = getTechniqueOptions("Embroidery", WITH_EMBROIDERY_CFG);
    expect(opts.filter((t) => t === "Embroidery")).toHaveLength(1);
  });

  it("returns just the enabled set when current technique is blank/unknown", () => {
    expect(getTechniqueOptions("", NO_EMBROIDERY_CFG)).toEqual(["Screen Print"]);
    expect(getTechniqueOptions(null, NO_EMBROIDERY_CFG)).toEqual(["Screen Print"]);
  });

  it("preserves a custom technique already on the line even if the shop removed it", () => {
    const opts = getTechniqueOptions("Puff Print", NO_EMBROIDERY_CFG);
    expect(opts).toContain("Puff Print");
    expect(opts).toContain("Screen Print");
  });

  it("trims the current technique before comparing (no stray whitespace dupes)", () => {
    const opts = getTechniqueOptions("  Embroidery  ", WITH_EMBROIDERY_CFG);
    expect(opts.filter((t) => t === "Embroidery")).toHaveLength(1);
  });
});
