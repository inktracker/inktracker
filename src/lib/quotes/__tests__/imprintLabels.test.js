import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isEmbroideryImprint,
  imprintColorLabel,
  stitchTierLabel,
  imprintCountText,
  DEFAULT_STITCH_TIERS,
} from "../imprintLabels.js";

describe("imprintColorLabel", () => {
  it("labels embroidery imprints as thread colors", () => {
    expect(imprintColorLabel({ technique: "Embroidery" })).toBe("Thread Colors");
  });

  it.each(["Screen Print", "DTF", "DTG", undefined, "", "Vinyl"])(
    "labels %j as ink colors",
    (technique) => {
      expect(imprintColorLabel({ technique })).toBe("Ink Colors");
    },
  );

  it("defaults to ink colors on a null/undefined imprint (never crashes a render)", () => {
    expect(imprintColorLabel(null)).toBe("Ink Colors");
    expect(imprintColorLabel(undefined)).toBe("Ink Colors");
  });

  it("isEmbroideryImprint is an exact match on the technique field", () => {
    expect(isEmbroideryImprint({ technique: "Embroidery" })).toBe(true);
    expect(isEmbroideryImprint({ technique: "embroidery" })).toBe(false); // stored value is capitalized
    expect(isEmbroideryImprint({})).toBe(false);
    expect(isEmbroideryImprint(null)).toBe(false);
  });
});

describe("stitchTierLabel", () => {
  const tiers = ["Under 5K", "5K-10K", "10K-15K", "15K+"];

  it.each([
    [1, "Under 5K"],
    [2, "5K-10K"],
    [3, "10K-15K"],
    [4, "15K+"],
  ])("maps the 1-based colors index %d to its tier label", (colors, label) => {
    expect(stitchTierLabel({ colors }, tiers)).toBe(label);
  });

  it("clamps an out-of-range index to the nearest tier (matches getEmbroideryPPP)", () => {
    expect(stitchTierLabel({ colors: 8 }, tiers)).toBe("15K+"); // screen-print count carried over
    expect(stitchTierLabel({ colors: 0 }, tiers)).toBe("Under 5K");
  });

  it("falls back to default tiers when none provided (customer page)", () => {
    expect(stitchTierLabel({ colors: 2 })).toBe("5K-10K");
    expect(stitchTierLabel({ colors: 2 }, [])).toBe("5K-10K");
    expect(stitchTierLabel({ colors: 2 }, null)).toBe("5K-10K");
  });

  it("honors a shop's CUSTOM tier labels", () => {
    expect(stitchTierLabel({ colors: 2 }, ["Small", "Medium", "Large"])).toBe("Medium");
  });
});

describe("imprintCountText", () => {
  it("renders the stitch tier for embroidery, never a color count", () => {
    expect(imprintCountText({ technique: "Embroidery", colors: 2 })).toBe("5K-10K stitches");
    expect(imprintCountText({ technique: "Embroidery", colors: 1 }, ["A", "B"])).toBe("A stitches");
  });

  it("renders a pluralized color count for non-embroidery", () => {
    expect(imprintCountText({ technique: "Screen Print", colors: 3 })).toBe("3 colors");
    expect(imprintCountText({ technique: "Screen Print", colors: 1 })).toBe("1 color");
  });

  it("returns empty string when there is nothing meaningful to show", () => {
    expect(imprintCountText({ technique: "Screen Print", colors: 0 })).toBe("");
    expect(imprintCountText({ technique: "DTF" })).toBe("");
  });
});

describe("DEFAULT_STITCH_TIERS stays in sync with the pricing engine", () => {
  it("matches DEFAULT_EMB_STITCH_TIERS in components/shared/pricing.jsx", () => {
    const pricingSrc = readFileSync(
      join(process.cwd(), "src", "components", "shared", "pricing.jsx"), "utf8");
    const m = pricingSrc.match(/DEFAULT_EMB_STITCH_TIERS\s*=\s*(\[[^\]]*\])/);
    expect(m, "DEFAULT_EMB_STITCH_TIERS not found in pricing.jsx").toBeTruthy();
    const pricingDefaults = JSON.parse(m[1].replace(/'/g, '"'));
    expect(DEFAULT_STITCH_TIERS).toEqual(pricingDefaults);
  });
});
