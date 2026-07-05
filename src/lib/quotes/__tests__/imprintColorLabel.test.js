import { describe, it, expect } from "vitest";
import { isEmbroideryImprint, imprintColorLabel } from "../imprintColorLabel.js";

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
