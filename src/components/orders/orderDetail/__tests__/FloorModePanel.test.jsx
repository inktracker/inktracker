// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import FloorModePanel from "../FloorModePanel";

const LIVE_ORDER = {
  status: "Printing",
  checklist: {},
  line_items: [
    {
      id: "li1",
      style: "Gildan 5000",
      garmentColor: "Black",
      sizes: { M: 10, L: 5 },
      imprints: [{ id: "imp1", location: "Front", colors: 2, technique: "Screen Print" }],
    },
  ],
};

const noop = () => {};

describe("FloorModePanel", () => {
  it("renders the Floor Mode header for the current stage", () => {
    render(
      <FloorModePanel
        liveOrder={LIVE_ORDER}
        floorCollapsed={false}
        setFloorCollapsed={noop}
        floorToggleTask={noop}
        floorTogglePrint={noop}
        floorToggleGoods={noop}
        bulkOrderGoodsStep={noop}
        saveShortfall={noop}
      />
    );
    expect(screen.getByText("Floor Mode — Printing")).toBeTruthy();
    expect(screen.getByText("Misprints")).toBeTruthy();
  });
});
