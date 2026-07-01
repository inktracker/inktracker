import { describe, it, expect } from "vitest";
import { normalizeLineItem } from "../wizardLineItem.js";

const NOW = 1782900000000;

describe("normalizeLineItem (createQuoteFromPayload)", () => {
  it("drops non-positive / non-finite sizes, keeps positive as numbers", () => {
    const li = normalizeLineItem({ sizes: { S: "10", M: 0, L: "-3", XL: "abc", "2XL": "5" } }, 0, NOW);
    expect(li.sizes).toEqual({ S: 10, "2XL": 5 });
  });

  it("defaults a missing imprint to a single Front / Screen Print / 1 color", () => {
    const li = normalizeLineItem({ style: "1717" }, 0, NOW);
    expect(li.imprints).toHaveLength(1);
    expect(li.imprints[0]).toMatchObject({ location: "Front", technique: "Screen Print", colors: 1 });
  });

  it("accepts a single `imprint` object OR an `imprints` array", () => {
    const single = normalizeLineItem({ imprint: { location: "Back", colors: "2" } }, 0, NOW);
    expect(single.imprints).toHaveLength(1);
    expect(single.imprints[0]).toMatchObject({ location: "Back", colors: 2 });
    const arr = normalizeLineItem({ imprints: [{ location: "Front" }, { location: "Left Chest", colors: 3 }] }, 0, NOW);
    expect(arr.imprints.map((i) => i.location)).toEqual(["Front", "Left Chest"]);
    expect(arr.imprints[1].colors).toBe(3);
  });

  it("coerces colors to a number, defaulting to 1", () => {
    const li = normalizeLineItem({ imprints: [{ colors: "0" }, { colors: "x" }, { colors: "4" }] }, 0, NOW);
    expect(li.imprints.map((i) => i.colors)).toEqual([1, 1, 4]);
  });

  it("maps alias fields (color→garmentColor, garment→category) and coerces garmentCost", () => {
    const li = normalizeLineItem({ color: "Black", garment: "T-Shirts", garmentCost: "4.62" }, 0, NOW);
    expect(li.garmentColor).toBe("Black");
    expect(li.category).toBe("T-Shirts");
    expect(li.garmentCost).toBe(4.62);
  });

  it("garmentCost is 0 (a number) when missing/invalid — never NaN/undefined", () => {
    expect(normalizeLineItem({}, 0, NOW).garmentCost).toBe(0);
    expect(normalizeLineItem({ garmentCost: "abc" }, 0, NOW).garmentCost).toBe(0);
  });

  it("only passes through optional catalog fields when present", () => {
    const bare = normalizeLineItem({ style: "X" }, 0, NOW);
    expect(bare).not.toHaveProperty("styleName");
    expect(bare).not.toHaveProperty("supplier");
    const rich = normalizeLineItem({ styleName: "Ring Spun", supplier: "S&S" }, 0, NOW);
    expect(rich).toMatchObject({ styleName: "Ring Spun", supplier: "S&S" });
  });

  it("deterministic ids for a fixed `now` (so the shape is testable)", () => {
    const li = normalizeLineItem({}, 2, NOW);
    expect(li.id).toBe(`li-2-${NOW}`);
    expect(li.imprints[0].id).toBe(`imp-2-${NOW}`);
  });
});
