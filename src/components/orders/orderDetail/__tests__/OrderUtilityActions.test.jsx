// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// pdfExport lazy-loads jspdf; stub the module so the import graph stays light.
vi.mock("../../../shared/pdfExport", () => ({ exportOrderToPDF: () => Promise.resolve(null) }));

import OrderUtilityActions from "../OrderUtilityActions";

const noop = () => {};

const PROPS = {
  order: { id: "o1" },
  liveOrder: { status: "Order Goods" },
  customer: {},
  shopName: "Ink Shop",
  logoUrl: "",
  copied: null,
  copyLink: noop,
  onOrderFromAC: noop,
  sourcePO: null,
  saving: false,
  onDelete: noop,
  callAction: noop,
};

describe("OrderUtilityActions", () => {
  it("renders the share, preview, and delete actions", () => {
    render(
      <MemoryRouter>
        <OrderUtilityActions {...PROPS} />
      </MemoryRouter>
    );
    expect(screen.getByText("Art Approval Link")).toBeTruthy();
    expect(screen.getByText("Status Link")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
    // Order Goods stage → the AC PO button ("Create PO") is shown.
    expect(screen.getByText("Create PO")).toBeTruthy();
  });
});
