// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import OrderLineItems from "../OrderLineItems";

const ORDER = {
  discount: 0,
  discount_type: "percent",
  tax_rate: 0,
  rush_rate: 0,
  notes: "Handle with care",
};

const LIVE_ORDER = {
  line_items: [
    {
      id: "li1",
      style: "Gildan 5000",
      garmentColor: "Black",
      garmentCost: 3.5,
      sizes: { M: 10, L: 5 },
      imprints: [{ id: "imp1", location: "Front", colors: 2, technique: "Screen Print" }],
      _ppp: 12,
      _lineTotal: 180,
    },
  ],
};

describe("OrderLineItems", () => {
  it("renders the garment, sizes, and order notes", () => {
    render(
      <OrderLineItems
        order={ORDER}
        liveOrder={LIVE_ORDER}
        isBrokerOrder={false}
        totals={{ sub: 180, afterDisc: 180, tax: 0, total: 180 }}
        isFlat={false}
        discVal={0}
        lineDiscountFactor={1}
        setPreviewArt={() => {}}
        handleReorderShortfall={() => {}}
        reorderCreating={false}
      />
    );
    expect(screen.getByText("Gildan 5000")).toBeTruthy();
    expect(screen.getByText(/Handle with care/)).toBeTruthy();
    expect(screen.getByText("Front")).toBeTruthy();
  });
});
