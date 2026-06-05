// Pinned contract for per-technique extras resolution. The quote
// editor surfaces only the addons matching the line's imprint
// technique, and this module is the single source of truth for that
// mapping. If something here changes the wrong way, a DTG line will
// silently show Screen Print fees (or vice versa) — exactly the
// "extras configured but not surfacing" bug the wiring PR is
// supposed to fix.

import { describe, it, expect } from "vitest";
import {
  sliceToAddons,
  buildAddonsByScope,
  getAddonsForTechnique,
} from "../extrasScopes";

describe("sliceToAddons", () => {
  it("returns [] when slice or slice.extras is missing", () => {
    expect(sliceToAddons(null)).toEqual([]);
    expect(sliceToAddons(undefined)).toEqual([]);
    expect(sliceToAddons({})).toEqual([]);
    expect(sliceToAddons({ extras: null })).toEqual([]);
  });

  it("maps {extras, extraLabels, extraModes} into the addon shape", () => {
    const out = sliceToAddons({
      extras: { tags: 1.5, colorMatch: 10 },
      extraLabels: { tags: "Custom Tags", colorMatch: "Color Match" },
      extraModes: { tags: "flat", colorMatch: "percent" },
    });
    expect(out).toEqual([
      { key: "colorMatch", label: "Color Match", rate: 10, mode: "percent" },
      { key: "tags", label: "Custom Tags", rate: 1.5, mode: "flat" },
    ]);
  });

  it("defaults missing modes to 'flat'", () => {
    const out = sliceToAddons({ extras: { foo: 2 } });
    expect(out[0].mode).toBe("flat");
  });

  it("defaults missing labels via camelCase → Title", () => {
    const out = sliceToAddons({ extras: { puffEmbroidery: 2 } });
    expect(out[0].label).toBe("Puff Embroidery");
  });

  it("prefers extraLabels over defaultLabels over auto", () => {
    const out = sliceToAddons(
      { extras: { tags: 1 }, extraLabels: { tags: "Shop Custom" } },
      { tags: "Default Label" }
    );
    expect(out[0].label).toBe("Shop Custom");
  });

  it("uses defaultLabels when extraLabels missing", () => {
    const out = sliceToAddons({ extras: { tags: 1 } }, { tags: "Default Label" });
    expect(out[0].label).toBe("Default Label");
  });

  it("coerces numeric-string rates ('1.5') to numbers", () => {
    const out = sliceToAddons({ extras: { tags: "1.5" } });
    expect(out[0].rate).toBe(1.5);
  });

  it("coerces unparseable rates to 0 (defensive)", () => {
    const out = sliceToAddons({ extras: { tags: "abc" } });
    expect(out[0].rate).toBe(0);
  });

  it("treats any mode value other than 'percent' as 'flat'", () => {
    const out = sliceToAddons({
      extras: { a: 1, b: 1, c: 1, d: 1 },
      extraModes: { a: "flat", b: "PERCENT", c: undefined, d: "weird" },
    });
    const modes = Object.fromEntries(out.map((x) => [x.key, x.mode]));
    expect(modes).toEqual({ a: "flat", b: "flat", c: "flat", d: "flat" });
  });

  it("sorts alphabetically by label, case-insensitive", () => {
    const out = sliceToAddons({
      extras: { a: 1, b: 1, c: 1 },
      extraLabels: { a: "Zebra", b: "alpha", c: "Mid" },
    });
    expect(out.map((x) => x.label)).toEqual(["alpha", "Mid", "Zebra"]);
  });
});

describe("buildAddonsByScope", () => {
  it("returns the stable empty shape for null cfg", () => {
    expect(buildAddonsByScope(null)).toEqual({ root: [], embroidery: [], custom: {} });
    expect(buildAddonsByScope(undefined)).toEqual({ root: [], embroidery: [], custom: {} });
    expect(buildAddonsByScope({})).toEqual({ root: [], embroidery: [], custom: {} });
  });

  it("populates root from cfg.extras", () => {
    const out = buildAddonsByScope({
      extras: { tags: 1.5 },
      extraLabels: { tags: "Custom Tags" },
    });
    expect(out.root).toEqual([{ key: "tags", label: "Custom Tags", rate: 1.5, mode: "flat" }]);
    expect(out.embroidery).toEqual([]);
    expect(out.custom).toEqual({});
  });

  it("populates embroidery from cfg.embroidery", () => {
    const out = buildAddonsByScope({
      embroidery: {
        extras: { puff: 2 },
        extraLabels: { puff: "Puff" },
        extraModes: { puff: "flat" },
      },
    });
    expect(out.embroidery).toEqual([{ key: "puff", label: "Puff", rate: 2, mode: "flat" }]);
    expect(out.root).toEqual([]);
  });

  it("populates custom from cfg.custom_techniques", () => {
    const out = buildAddonsByScope({
      custom_techniques: {
        DTG: { extras: { rush: 1 }, extraLabels: { rush: "Rush Setup" } },
        DTF: { extras: { color: 0.5 } },
      },
    });
    expect(Object.keys(out.custom)).toEqual(["DTG", "DTF"]);
    expect(out.custom.DTG).toEqual([{ key: "rush", label: "Rush Setup", rate: 1, mode: "flat" }]);
    expect(out.custom.DTF[0].label).toBe("Color");
  });

  it("threads defaultLabels into root only", () => {
    const out = buildAddonsByScope(
      { extras: { tags: 1 }, embroidery: { extras: { tags: 1 } } },
      { tags: "Custom Tags" }
    );
    expect(out.root[0].label).toBe("Custom Tags");
    expect(out.embroidery[0].label).toBe("Tags");
  });
});

describe("getAddonsForTechnique", () => {
  const byScope = {
    root: [{ key: "tags", label: "Tags", rate: 1, mode: "flat" }],
    embroidery: [{ key: "puff", label: "Puff", rate: 2, mode: "flat" }],
    custom: {
      DTG: [{ key: "rush", label: "Rush", rate: 3, mode: "flat" }],
      DTF: [],
    },
  };

  it("returns embroidery list for technique='Embroidery'", () => {
    expect(getAddonsForTechnique(byScope, "Embroidery")).toBe(byScope.embroidery);
  });

  it("returns the matching custom list when the technique name is in the map", () => {
    expect(getAddonsForTechnique(byScope, "DTG")).toBe(byScope.custom.DTG);
  });

  it("returns an empty array for a custom technique with no fees", () => {
    expect(getAddonsForTechnique(byScope, "DTF")).toEqual([]);
  });

  it("falls back to root for unknown technique names", () => {
    expect(getAddonsForTechnique(byScope, "VinylTransfer")).toBe(byScope.root);
  });

  it("falls back to root for 'Screen Print' (the default technique)", () => {
    expect(getAddonsForTechnique(byScope, "Screen Print")).toBe(byScope.root);
  });

  it("falls back to root when technique is undefined/null", () => {
    expect(getAddonsForTechnique(byScope, undefined)).toBe(byScope.root);
    expect(getAddonsForTechnique(byScope, null)).toBe(byScope.root);
  });

  it("returns [] when byScope itself is null/undefined", () => {
    expect(getAddonsForTechnique(null, "Embroidery")).toEqual([]);
    expect(getAddonsForTechnique(undefined, "DTG")).toEqual([]);
  });

  it("does not confuse a custom technique name 'embroidery' (lowercase) with the embroidery scope", () => {
    // Defensive: scope picking keys off the canonical capital-E
    // "Embroidery" only — a custom method literally named
    // "embroidery" (lowercase) should hit the custom map, not the
    // embroidery slice.
    const tricky = {
      ...byScope,
      custom: { ...byScope.custom, embroidery: [{ key: "weird", label: "Weird", rate: 9, mode: "flat" }] },
    };
    expect(getAddonsForTechnique(tricky, "embroidery")).toBe(tricky.custom.embroidery);
    expect(getAddonsForTechnique(tricky, "Embroidery")).toBe(tricky.embroidery);
  });
});
