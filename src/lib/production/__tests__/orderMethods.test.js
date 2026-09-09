import { describe, it, expect } from "vitest";
import { orderMethods, orderHasMethod, availableMethods } from "../orderMethods";

const order = (imprintTechs) => ({
  line_items: imprintTechs.map((techs) => ({
    imprints: techs.map((t) => ({ technique: t, colors: 1 })),
  })),
});

describe("orderMethods", () => {
  it("collects distinct techniques across line items", () => {
    const o = order([["Screen Print"], ["Embroidery", "Screen Print"]]);
    expect([...orderMethods(o)].sort()).toEqual(["Embroidery", "Screen Print"]);
  });
  it("tolerates missing/blank/legacy shapes", () => {
    expect(orderMethods(null).size).toBe(0);
    expect(orderMethods({ line_items: null }).size).toBe(0);
    expect(orderMethods({ line_items: [{ imprints: [{ technique: "  " }] }] }).size).toBe(0);
  });
});

describe("orderHasMethod", () => {
  const o = order([["Screen Print"], ["Embroidery"]]);
  it("matches case/space-insensitively", () => {
    expect(orderHasMethod(o, "embroidery")).toBe(true);
    expect(orderHasMethod(o, " Screen Print ")).toBe(true);
  });
  it("returns false for a method not on the order", () => {
    expect(orderHasMethod(o, "DTF")).toBe(false);
  });
  it("'All' or falsy method never filters", () => {
    expect(orderHasMethod(o, "All")).toBe(true);
    expect(orderHasMethod(o, "")).toBe(true);
    expect(orderHasMethod({}, "All")).toBe(true);
  });
});

describe("availableMethods", () => {
  it("known methods first in sequence, custom ones alphabetical", () => {
    const orders = [
      order([["Embroidery"]]),
      order([["Screen Print"]]),
      order([["Foil"]]),
      order([["DTF"]]),
    ];
    expect(availableMethods(orders)).toEqual(["Screen Print", "Embroidery", "DTF", "Foil"]);
  });
  it("empty for no orders / no imprints", () => {
    expect(availableMethods([])).toEqual([]);
    expect(availableMethods([{ line_items: [] }])).toEqual([]);
  });
});
