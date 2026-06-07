// Tests for the press configuration normalizer. The shape of
// shop.presses has evolved twice (v1 strings, v2 objects with
// color/station count). normalizePresses is the single read path
// that has to keep both working forever, so this suite exists to
// pin that contract.

import { describe, it, expect } from "vitest";
import { normalizePresses, serializePresses, normalizeAssignedPress } from "../normalizePresses";

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

describe("normalizePresses — JSON-stringified entries (double-encoded data)", () => {
  // Bug surfaced 2026-06-05: some shops' shop.presses rows ended up
  // with each press stored as a JSON-stringified object instead of a
  // real JSONB object. Without the defensive unwrap, the entire
  // `'{"name":"Riley Hopkins 360","colors":8}'` string was being
  // shown as the press's name in the editor input. Pin the recovery.
  it("unwraps a stringified v2 object back to { name, colors }", () => {
    expect(normalizePresses(['{"name":"Riley Hopkins 360","colors":8}'])).toEqual([
      { name: "Riley Hopkins 360", colors: 8 },
    ]);
  });

  it("unwraps a stringified v2 object with no colors", () => {
    expect(normalizePresses(['{"name":"Auto 1"}'])).toEqual([
      { name: "Auto 1", colors: null },
    ]);
  });

  it("treats a non-JSON brace-looking string as a plain name", () => {
    // Defensive: shop accidentally typed `{Auto 1}` as a press name.
    // We don't blow up; we treat it as a v1 name string.
    expect(normalizePresses(["{Auto 1}"])).toEqual([
      { name: "{Auto 1}", colors: null },
    ]);
  });

  it("handles a stringified object with a numeric-string colors field", () => {
    expect(normalizePresses(['{"name":"Auto 1","colors":"6"}'])).toEqual([
      { name: "Auto 1", colors: 6 },
    ]);
  });

  it("mixes string, object, and stringified-object entries in one save", () => {
    expect(normalizePresses([
      "Auto 1",
      { name: "Manual A", colors: 6 },
      '{"name":"Manual B","colors":4}',
    ])).toEqual([
      { name: "Auto 1", colors: null },
      { name: "Manual A", colors: 6 },
      { name: "Manual B", colors: 4 },
    ]);
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

describe("normalizeAssignedPress — single-value readers", () => {
  // The bug Joe surfaced: ORD-2026-ZMN57 stored `assigned_press` as
  // `'{"name":"Riley Hopkins 360","colors":8}'` (the whole v2 press
  // object JSON-stringified). The Production table rendered the raw
  // string AND the scheduler's `o.assigned_press === pressName`
  // strict-equality check failed because pressName was the bare
  // "Riley Hopkins 360". Result: the order showed JSON in the table
  // and silently fell off its press lane.

  it("returns '' for null / undefined / empty", () => {
    expect(normalizeAssignedPress(null)).toBe("");
    expect(normalizeAssignedPress(undefined)).toBe("");
    expect(normalizeAssignedPress("")).toBe("");
    expect(normalizeAssignedPress("   ")).toBe("");
  });

  it("returns plain v1 strings trimmed", () => {
    expect(normalizeAssignedPress("Riley Hopkins 360")).toBe("Riley Hopkins 360");
    expect(normalizeAssignedPress("  Manual A  ")).toBe("Manual A");
  });

  it("unwraps the bug-shape: a JSON-stringified press object", () => {
    expect(normalizeAssignedPress('{"name":"Riley Hopkins 360","colors":8}'))
      .toBe("Riley Hopkins 360");
    expect(normalizeAssignedPress('{"name":"Auto 1","colors":6}'))
      .toBe("Auto 1");
  });

  it("trims the name unwrapped from a JSON-string entry", () => {
    expect(normalizeAssignedPress('{"name":"  Auto 1  ","colors":8}'))
      .toBe("Auto 1");
  });

  it("falls back to plain-string treatment when the JSON-looking string isn't a valid press object", () => {
    // Real string content that happens to start with `{` and end with `}` —
    // shouldn't crash, shouldn't lose data.
    expect(normalizeAssignedPress("{not actually json}"))
      .toBe("{not actually json}");
    expect(normalizeAssignedPress('{"colors":8}')) // no name key
      .toBe('{"colors":8}');
  });

  it("accepts an actual object (not just JSON-stringified) defensively", () => {
    // Some code paths might pass the parsed v2 object directly.
    expect(normalizeAssignedPress({ name: "Riley Hopkins 360", colors: 8 }))
      .toBe("Riley Hopkins 360");
    expect(normalizeAssignedPress({ name: "", colors: 8 })).toBe("");
  });

  it("ignores junk types", () => {
    expect(normalizeAssignedPress(42)).toBe("");
    expect(normalizeAssignedPress(true)).toBe("");
    expect(normalizeAssignedPress([])).toBe("");
  });
});
