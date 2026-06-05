// Tests for the press configuration normalizer. The shape of
// shop.presses has evolved twice (v1 strings, v2 objects with
// color/station count). normalizePresses is the single read path
// that has to keep both working forever, so this suite exists to
// pin that contract.

import { describe, it, expect } from "vitest";
import { normalizePresses, serializePresses } from "../normalizePresses";

describe("normalizePresses — input shapes", () => {
  it("returns [] for non-array input", () => {
    expect(normalizePresses(null)).toEqual([]);
    expect(normalizePresses(undefined)).toEqual([]);
    expect(normalizePresses({})).toEqual([]);
    expect(normalizePresses("Auto 1")).toEqual([]);
    expect(normalizePresses(42)).toEqual([]);
  });

  it("promotes v1 string entries to v2 objects with null colors", () => {
    expect(normalizePresses(["Auto 1", "Manual A"])).toEqual([
      { name: "Auto 1", colors: null },
      { name: "Manual A", colors: null },
    ]);
  });

  it("preserves v2 object entries unchanged when fully formed", () => {
    expect(normalizePresses([
      { name: "Auto 1", colors: 8 },
      { name: "Manual A", colors: 6 },
    ])).toEqual([
      { name: "Auto 1", colors: 8 },
      { name: "Manual A", colors: 6 },
    ]);
  });

  it("accepts mixed v1 + v2 in the same array (transitional state)", () => {
    expect(normalizePresses([
      "Auto 1",
      { name: "Manual A", colors: 6 },
    ])).toEqual([
      { name: "Auto 1", colors: null },
      { name: "Manual A", colors: 6 },
    ]);
  });
});

describe("normalizePresses — name handling", () => {
  it("trims whitespace from names", () => {
    expect(normalizePresses(["  Auto 1  ", { name: "  Manual A  ", colors: 6 }])).toEqual([
      { name: "Auto 1", colors: null },
      { name: "Manual A", colors: 6 },
    ]);
  });

  it("drops entries with empty names after trim", () => {
    expect(normalizePresses(["", "   ", { name: "" }, { name: "   " }, "Auto 1"]))
      .toEqual([{ name: "Auto 1", colors: null }]);
  });

  it("drops non-object/non-string entries (defensive)", () => {
    expect(normalizePresses([null, undefined, 42, true, "Auto 1"]))
      .toEqual([{ name: "Auto 1", colors: null }]);
  });
});

describe("normalizePresses — color count handling", () => {
  it("keeps positive integers", () => {
    expect(normalizePresses([{ name: "A", colors: 1 }])[0])
      .toEqual({ name: "A", colors: 1 });
    expect(normalizePresses([{ name: "A", colors: 12 }])[0])
      .toEqual({ name: "A", colors: 12 });
  });

  it("coerces numeric strings", () => {
    expect(normalizePresses([{ name: "A", colors: "8" }])).toEqual([
      { name: "A", colors: 8 },
    ]);
  });

  it("nulls out zero, negative, NaN, and non-finite color counts", () => {
    expect(normalizePresses([{ name: "A", colors: 0 }])[0].colors).toBeNull();
    expect(normalizePresses([{ name: "A", colors: -3 }])[0].colors).toBeNull();
    expect(normalizePresses([{ name: "A", colors: NaN }])[0].colors).toBeNull();
    expect(normalizePresses([{ name: "A", colors: Infinity }])[0].colors).toBeNull();
    expect(normalizePresses([{ name: "A", colors: "abc" }])[0].colors).toBeNull();
    expect(normalizePresses([{ name: "A", colors: null }])[0].colors).toBeNull();
    expect(normalizePresses([{ name: "A", colors: undefined }])[0].colors).toBeNull();
  });
});

describe("serializePresses — write-back round-trip", () => {
  it("is idempotent — normalize → serialize → normalize is stable", () => {
    const input = ["Auto 1", { name: "Manual A", colors: "6" }, ""];
    const once = normalizePresses(input);
    const twice = serializePresses(once);
    const thrice = normalizePresses(twice);
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  it("drops the empty row that the Account editor creates when '+ Add press' is clicked but never filled in", () => {
    const editing = [
      { name: "Auto 1", colors: 8 },
      { name: "", colors: null }, // user clicked +Add and walked away
      { name: "Manual A", colors: 6 },
    ];
    expect(serializePresses(editing)).toEqual([
      { name: "Auto 1", colors: 8 },
      { name: "Manual A", colors: 6 },
    ]);
  });
});
