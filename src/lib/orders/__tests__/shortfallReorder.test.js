import { describe, it, expect } from "vitest";
import {
  buildShortfallReorderPayload,
  buildShortfallReorderPayloads,
  totalOrderShortfall,
} from "../shortfallReorder";

const USER = { email: "shop@example.com" };

function makeOrder(overrides = {}) {
  return {
    id: "uuid-1",
    order_id: "ORD-2026-XYZ",
    shop_owner: "shop@example.com",
    line_items: [
      {
        id: "li1",
        style: "1717",
        garmentColor: "Black",
        sizes: { S: 10, M: 15 },
        _shortfall: { M: 2 },
      },
    ],
    ...overrides,
  };
}

describe("totalOrderShortfall", () => {
  it("TS1 — sums across line items and sizes", () => {
    const order = makeOrder({
      line_items: [
        { id: "a", _shortfall: { S: 1, M: 2 } },
        { id: "b", _shortfall: { L: 3 } },
      ],
    });
    expect(totalOrderShortfall(order)).toBe(6);
  });

  it("TS2 — returns 0 when no shortfall set", () => {
    expect(totalOrderShortfall(makeOrder({ line_items: [{ id: "a" }] }))).toBe(0);
    expect(totalOrderShortfall({ line_items: [] })).toBe(0);
    expect(totalOrderShortfall(null)).toBe(0);
  });
});

describe("buildShortfallReorderPayload (single-supplier wrapper)", () => {
  it("BR1 — returns null when no user", () => {
    expect(buildShortfallReorderPayload(makeOrder(), null)).toBeNull();
  });

  it("BR2 — returns null when no shortfall", () => {
    const order = makeOrder({ line_items: [{ id: "a", style: "X", sizes: { M: 1 } }] });
    expect(buildShortfallReorderPayload(order, USER)).toBeNull();
  });

  it("BR3 — builds one PO item per shortfall-size pair", () => {
    const order = makeOrder({
      line_items: [
        {
          id: "li1",
          style: "1717",
          garmentColor: "Black",
          _shortfall: { S: 1, M: 2 },
        },
        {
          id: "li2",
          style: "5102",
          garmentColor: "White",
          _shortfall: { L: 3 },
        },
      ],
    });
    const payload = buildShortfallReorderPayload(order, USER);
    expect(payload.items).toHaveLength(3);
    expect(payload.items).toContainEqual(
      expect.objectContaining({ styleCode: "1717", color: "Black", size: "S", quantity: 1, sku: "1717BLACK-S" }),
    );
    expect(payload.items).toContainEqual(
      expect.objectContaining({ styleCode: "5102", color: "White", size: "L", quantity: 3, sku: "5102WHITE-L" }),
    );
  });

  it("BR3b — emits the CANONICAL item shape (quantity/styleCode/unitPrice/warehouse), not the old {qty,style}", () => {
    const order = makeOrder({ line_items: [{ id: "li1", style: "1717", garmentColor: "Black", garmentCost: 4.25, _shortfall: { M: 2 } }] });
    const it = buildShortfallReorderPayload(order, USER).items[0];
    expect(it).toEqual({ sku: "1717BLACK-M", styleCode: "1717", color: "Black", size: "M", quantity: 2, unitPrice: 4.25, warehouse: "" });
    expect(it.qty).toBeUndefined();
    expect(it.style).toBeUndefined();
  });

  it("BR4 — links source_order_id to the order UUID (not the human order_id — the B2 insert bug)", () => {
    const payload = buildShortfallReorderPayload(makeOrder(), USER);
    expect(payload.source_order_id).toBe("uuid-1");
  });

  it("BR5 — reference is the order ref, ≤20 chars for AS Colour", () => {
    const payload = buildShortfallReorderPayload(makeOrder(), USER);
    expect(payload.reference).toBe("ORD-2026-XYZ");
    expect(payload.reference.length).toBeLessThanOrEqual(20);
  });

  it("BR6 — defaults supplier to AS Colour when no supplier set on line items", () => {
    const payload = buildShortfallReorderPayload(makeOrder(), USER);
    expect(payload.supplier).toBe("AS Colour");
  });

  it("BR7 — uses line item's existing sku when set", () => {
    const order = makeOrder({
      line_items: [{ id: "li1", style: "ignored", sku: "CUSTOM-SKU", _shortfall: { M: 2 } }],
    });
    const payload = buildShortfallReorderPayload(order, USER);
    expect(payload.items[0].sku).toBe("CUSTOM-SKU");
  });

  it("BR8 — skips sizes with qty 0 or junk values", () => {
    const order = makeOrder({
      line_items: [{ id: "li1", style: "1717", garmentColor: "Black", _shortfall: { S: 0, M: "abc", L: 2 } }],
    });
    const payload = buildShortfallReorderPayload(order, USER);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].size).toBe("L");
  });

  it("BR9 — payload status is 'draft' so the shop reviews before sending", () => {
    const payload = buildShortfallReorderPayload(makeOrder(), USER);
    expect(payload.status).toBe("draft");
  });
});

describe("buildShortfallReorderPayloads (multi-supplier)", () => {
  it("BRM1 — returns empty array when no user or no shortfall", () => {
    expect(buildShortfallReorderPayloads(makeOrder(), null)).toEqual([]);
    const order = makeOrder({ line_items: [{ id: "a", style: "X" }] });
    expect(buildShortfallReorderPayloads(order, USER)).toEqual([]);
  });

  it("BRM2 — single supplier order produces one payload (no supplier suffix)", () => {
    const order = makeOrder({
      line_items: [
        { id: "li1", style: "1717", supplier: "AS Colour", garmentColor: "Black", _shortfall: { M: 2 } },
        { id: "li2", style: "5102", supplier: "AS Colour", garmentColor: "White", _shortfall: { L: 3 } },
      ],
    });
    const payloads = buildShortfallReorderPayloads(order, USER);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].supplier).toBe("AS Colour");
    expect(payloads[0].reference).toBe("ORD-2026-XYZ");
    expect(payloads[0].items).toHaveLength(2);
  });

  it("BRM3 — mixed-supplier order is bucketed into separate POs", () => {
    const order = makeOrder({
      line_items: [
        { id: "li1", style: "1717", supplier: "AS Colour",      garmentColor: "Black", _shortfall: { M: 2 } },
        { id: "li2", style: "G500", supplier: "S&S Activewear", garmentColor: "Navy",  _shortfall: { L: 3 } },
        { id: "li3", style: "5102", supplier: "AS Colour",      garmentColor: "White", _shortfall: { S: 1 } },
      ],
    });
    const payloads = buildShortfallReorderPayloads(order, USER);
    // Alphabetical order keeps the test deterministic: AS Colour, S&S Activewear
    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.supplier)).toEqual(["AS Colour", "S&S Activewear"]);

    const ac = payloads.find((p) => p.supplier === "AS Colour");
    const ss = payloads.find((p) => p.supplier === "S&S Activewear");
    expect(ac.items).toHaveLength(2);
    expect(ss.items).toHaveLength(1);
    expect(ac.items.map((i) => i.styleCode).sort()).toEqual(["1717", "5102"]);
    expect(ss.items[0].styleCode).toBe("G500");
  });

  it("BRM4 — multi-supplier references include supplier suffix", () => {
    const order = makeOrder({
      line_items: [
        { id: "li1", style: "1717", supplier: "AS Colour",      _shortfall: { M: 1 } },
        { id: "li2", style: "G500", supplier: "S&S Activewear", _shortfall: { L: 1 } },
      ],
    });
    const payloads = buildShortfallReorderPayloads(order, USER);
    expect(payloads.find((p) => p.supplier === "AS Colour").reference)
      .toBe("ORD-2026-XYZ-AC");
    expect(payloads.find((p) => p.supplier === "S&S Activewear").reference)
      .toBe("ORD-2026-XYZ-SS");
  });

  it("BRM5 — line items without supplier default to AS Colour", () => {
    const order = makeOrder({
      line_items: [
        { id: "li1", style: "1717", garmentColor: "Black", _shortfall: { M: 2 } },
      ],
    });
    const payloads = buildShortfallReorderPayloads(order, USER);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].supplier).toBe("AS Colour");
  });
});
