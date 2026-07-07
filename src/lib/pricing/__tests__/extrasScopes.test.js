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
  pruneExtrasForTechnique,
  getAddonsForTechniques,
  pruneExtrasForTechniques,
  getActiveAddonLabels,
} from "../extrasScopes";

describe("getActiveAddonLabels", () => {
  const cfg = {
    extras: { colorMatch: 1, tags: 1.5 },
    extraLabels: { colorMatch: "Pantone Match", tags: "Custom Tags" },
  };

  it("returns labels for ON add-ons only (skips false)", () => {
    const li = { imprints: [{ technique: "Screen Print" }], extras: { colorMatch: 1, tags: false } };
    expect(getActiveAddonLabels(li, {}, cfg)).toEqual(["Pantone Match"]);
  });

  it("returns [] when nothing is toggled on", () => {
    const li = { imprints: [{ technique: "Screen Print" }], extras: { colorMatch: false } };
    expect(getActiveAddonLabels(li, {}, cfg)).toEqual([]);
  });

  it("falls back to an auto-label when the key has no configured label", () => {
    const li = { imprints: [{ technique: "Screen Print" }], extras: { puffEmbroidery: 1 } };
    expect(getActiveAddonLabels(li, {}, cfg)).toEqual(["Puff Embroidery"]);
  });

  it("uses the quote-level extras fallback for legacy quotes (no li.extras)", () => {
    const li = { imprints: [{ technique: "Screen Print" }] }; // no own extras
    const quote = { extras: { colorMatch: 1 } };
    expect(getActiveAddonLabels(li, quote, cfg)).toEqual(["Pantone Match"]);
  });
});

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

describe("pruneExtrasForTechnique", () => {
  const byScope = {
    root: [
      { key: "tags", label: "Tags", rate: 1.5, mode: "flat" },
      { key: "colorMatch", label: "Color Match", rate: 1, mode: "flat" },
    ],
    embroidery: [{ key: "puff", label: "Puff", rate: 2, mode: "flat" }],
    custom: { DTG: [{ key: "rush", label: "Rush", rate: 3, mode: "flat" }] },
  };

  it("drops keys not present in the new technique's addon list", () => {
    const extras = { tags: 1.5, colorMatch: 1 };
    // Switching from Screen Print (root) → Embroidery should drop
    // tags + colorMatch because neither exists in the embroidery scope.
    expect(pruneExtrasForTechnique(extras, byScope, "Embroidery")).toEqual({});
  });

  it("keeps keys that exist in the new technique's addon list", () => {
    const extras = { tags: 1.5, colorMatch: 1 };
    // Switching back to Screen Print → both keys allowed.
    expect(pruneExtrasForTechnique(extras, byScope, "Screen Print")).toEqual({
      tags: 1.5,
      colorMatch: 1,
    });
  });

  it("keeps overlapping keys when two scopes share a name", () => {
    const overlap = {
      ...byScope,
      embroidery: [{ key: "tags", label: "Embroidered Tags", rate: 2, mode: "flat" }],
    };
    const extras = { tags: 1.5, colorMatch: 1 };
    // The 'tags' key happens to exist in BOTH scopes (different
    // labels / rates). Keep the snapshot — engine reads the rate
    // from li.extras, not from the addon meta.
    expect(pruneExtrasForTechnique(extras, overlap, "Embroidery")).toEqual({ tags: 1.5 });
  });

  it("preserves explicit-false (turned-off) entries when the key is in scope", () => {
    // The toggle UI sets value=false to mean "explicitly off". We
    // keep it so engine math stays a no-op rather than ambiguous.
    expect(pruneExtrasForTechnique({ tags: false }, byScope, "Screen Print")).toEqual({ tags: false });
  });

  it("returns {} when extras is null/undefined/non-object", () => {
    expect(pruneExtrasForTechnique(null, byScope, "Embroidery")).toEqual({});
    expect(pruneExtrasForTechnique(undefined, byScope, "Embroidery")).toEqual({});
    expect(pruneExtrasForTechnique("nope", byScope, "Embroidery")).toEqual({});
  });

  it("returns {} when byScope is null (defensive)", () => {
    expect(pruneExtrasForTechnique({ tags: 1.5 }, null, "Screen Print")).toEqual({});
  });

  it("falls back to root scope for unknown technique names", () => {
    const extras = { tags: 1.5, puff: false };
    // 'VinylTransfer' is not a registered scope → root applies →
    // keep tags (in root), drop puff (not in root).
    expect(pruneExtrasForTechnique(extras, byScope, "VinylTransfer")).toEqual({ tags: 1.5 });
  });

  it("preserves percent-mode object snapshots when allowed", () => {
    const extras = { tags: { mode: "percent", rate: 10 } };
    expect(pruneExtrasForTechnique(extras, byScope, "Screen Print")).toEqual({
      tags: { mode: "percent", rate: 10 },
    });
  });

  it("custom technique scope: keeps that scope's keys, drops everything else", () => {
    const extras = { tags: 1.5, rush: 3, puff: false };
    expect(pruneExtrasForTechnique(extras, byScope, "DTG")).toEqual({ rush: 3 });
  });
});

describe("getActiveAddonLabels — edge cases", () => {
  it("resolves an Embroidery-scope add-on label (technique-scoped)", () => {
    const cfg = {
      extras: { colorMatch: 1 }, extraLabels: { colorMatch: "Pantone Match" },
      embroidery: { extras: { puff: 1 }, extraLabels: { puff: "Puff / 3D" } },
    };
    const li = { imprints: [{ technique: "Embroidery" }], extras: { puff: 1 } };
    expect(getActiveAddonLabels(li, {}, cfg)).toEqual(["Puff / 3D"]);
  });

  it("labels a percent-mode add-on (object snapshot is still 'on')", () => {
    const cfg = { extras: { rush: 10 }, extraModes: { rush: "percent" }, extraLabels: { rush: "Rush" } };
    const li = { imprints: [{ technique: "Screen Print" }], extras: { rush: { mode: "percent", rate: 10 } } };
    expect(getActiveAddonLabels(li, {}, cfg)).toEqual(["Rush"]);
  });

  it("auto-labels when config is null/empty", () => {
    const li = { imprints: [{ technique: "Screen Print" }], extras: { colorMatch: 1 } };
    expect(getActiveAddonLabels(li, {}, null)).toEqual(["Color Match"]);
  });

  it("returns multiple active labels", () => {
    const cfg = { extras: { colorMatch: 1, waterbased: 1 }, extraLabels: { colorMatch: "Pantone Match", waterbased: "Water-Based Ink" } };
    const li = { imprints: [{ technique: "Screen Print" }], extras: { colorMatch: 1, waterbased: 1, tags: false } };
    expect(getActiveAddonLabels(li, {}, cfg).sort()).toEqual(["Pantone Match", "Water-Based Ink"]);
  });

  it("no imprints → falls back to root scope, still labels", () => {
    const cfg = { extras: { colorMatch: 1 }, extraLabels: { colorMatch: "Pantone Match" } };
    const li = { extras: { colorMatch: 1 } };
    expect(getActiveAddonLabels(li, {}, cfg)).toEqual(["Pantone Match"]);
  });
});

// ── Union across a line's techniques (Kato's report, 2026-07) ─────────
describe("getAddonsForTechniques (union across a line's locations)", () => {
  const byScope = {
    root: [{ key: "underbase", label: "Underbase", rate: 1, mode: "flat" }],
    embroidery: [{ key: "puff", label: "Puff", rate: 2, mode: "flat" }],
    custom: { DTF: [{ key: "peel", label: "Cold Peel", rate: 3, mode: "flat" }] },
  };

  it("surfaces a Screen Print fee even when Screen Print isn't the FIRST location", () => {
    // Kato: Embroidery front + Screen Print back → underbase must be reachable.
    const keys = getAddonsForTechniques(byScope, ["Embroidery", "Screen Print"]).map((a) => a.key);
    expect(keys).toContain("underbase");
    expect(keys).toContain("puff");
  });

  it("does NOT surface underbase when no location supports it", () => {
    const keys = getAddonsForTechniques(byScope, ["Embroidery"]).map((a) => a.key);
    expect(keys).toEqual(["puff"]);
  });

  it("dedupes by key across locations of the same technique", () => {
    const out = getAddonsForTechniques(byScope, ["Screen Print", "Screen Print"]);
    expect(out.map((a) => a.key)).toEqual(["underbase"]);
  });

  it("falls back to the root scope when no techniques are given", () => {
    expect(getAddonsForTechniques(byScope, []).map((a) => a.key)).toEqual(["underbase"]);
    expect(getAddonsForTechniques(byScope, undefined).map((a) => a.key)).toEqual(["underbase"]);
  });

  it("sorts unioned add-ons alphabetically by label", () => {
    const labels = getAddonsForTechniques(byScope, ["DTF", "Screen Print"]).map((a) => a.label);
    expect(labels).toEqual(["Cold Peel", "Underbase"]);
  });

  it("returns [] with no byScope", () => {
    expect(getAddonsForTechniques(null, ["Screen Print"])).toEqual([]);
  });
});

describe("pruneExtrasForTechniques (union-based prune)", () => {
  const byScope = {
    root: [{ key: "underbase", label: "Underbase", rate: 1, mode: "flat" }],
    embroidery: [{ key: "puff", label: "Puff", rate: 2, mode: "flat" }],
    custom: {},
  };

  it("keeps a fee still supported by ANOTHER location after one location's technique changes", () => {
    // Line had two Screen Print locations with underbase on; one flips to Embroidery.
    // underbase must survive because a Screen Print location remains.
    const out = pruneExtrasForTechniques({ underbase: 1 }, byScope, ["Embroidery", "Screen Print"]);
    expect(out).toEqual({ underbase: 1 });
  });

  it("drops a fee once NO location supports it", () => {
    const out = pruneExtrasForTechniques({ underbase: 1 }, byScope, ["Embroidery"]);
    expect(out).toEqual({});
  });

  it("returns {} for non-object extras", () => {
    expect(pruneExtrasForTechniques(null, byScope, ["Screen Print"])).toEqual({});
  });
});
