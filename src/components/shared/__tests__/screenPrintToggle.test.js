// A shop can turn Screen Print OFF (e.g. an embroidery-only shop) via
// pricing_config.screenPrint.enabled = false. Guards: default-on for every
// existing shop (absent flag), never leave zero methods, and old screen-print
// quotes stay editable.

import { describe, it, expect } from "vitest";
import { getEnabledTechniques, getDefaultTechnique, getTechniqueOptions } from "../pricing";

const EMB_ON = { embroidery: { enabled: true, pricing: { "Under 5K": { 72: 5.75 } } } };

describe("screen-print off flag — getEnabledTechniques", () => {
  it("is ON by default (absent flag) — backward compatible", () => {
    expect(getEnabledTechniques({})).toEqual(["Screen Print"]);
    expect(getEnabledTechniques({ screenPrint: {} })).toEqual(["Screen Print"]);
    expect(getEnabledTechniques({ screenPrint: { enabled: true } })).toEqual(["Screen Print"]);
  });

  it("only an explicit false removes Screen Print", () => {
    const cfg = { screenPrint: { enabled: false }, ...EMB_ON };
    expect(getEnabledTechniques(cfg)).toEqual(["Embroidery"]);
    expect(getEnabledTechniques(cfg)).not.toContain("Screen Print");
  });

  it("keeps custom techniques when Screen Print is off", () => {
    const cfg = { screenPrint: { enabled: false }, ...EMB_ON, custom_techniques: { DTF: {} } };
    expect(getEnabledTechniques(cfg)).toEqual(["Embroidery", "DTF"]);
  });

  it("never returns zero methods — falls back to Screen Print if everything is off", () => {
    // Screen Print off AND no embroidery/custom = nonsensical; safety net keeps quoting alive.
    expect(getEnabledTechniques({ screenPrint: { enabled: false } })).toEqual(["Screen Print"]);
  });
});

describe("getDefaultTechnique — new-imprint default", () => {
  it("is Screen Print for a normal shop", () => {
    expect(getDefaultTechnique({})).toBe("Screen Print");
  });
  it("is the first remaining method for an embroidery-only shop", () => {
    expect(getDefaultTechnique({ screenPrint: { enabled: false }, ...EMB_ON })).toBe("Embroidery");
  });
});

describe("old quotes stay editable when Screen Print is turned off", () => {
  it("getTechniqueOptions still offers Screen Print if the saved line uses it", () => {
    const cfg = { screenPrint: { enabled: false }, ...EMB_ON };
    const opts = getTechniqueOptions("Screen Print", cfg);
    expect(opts).toContain("Screen Print"); // the line's own technique is preserved
    expect(opts).toContain("Embroidery");
  });
  it("a brand-new line (blank technique) does NOT offer Screen Print when off", () => {
    const cfg = { screenPrint: { enabled: false }, ...EMB_ON };
    expect(getTechniqueOptions("", cfg)).toEqual(["Embroidery"]);
  });
});
