// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import OrderInvoiceActions from "../OrderInvoiceActions";

const noop = () => {};

const BASE = {
  saving: false,
  onRevert: noop,
  onAdvance: noop,
  onShowInvoice: noop,
  onComplete: noop,
  onTogglePaid: noop,
  onClose: noop,
  prevStatus: "Pre-Press",
  nextStatus: "Printing",
  relatedInvoice: null,
  creatingInvoice: false,
  qbPushNote: "",
  callAction: noop,
  advanceWithGoodsGuard: noop,
  handleCreateInvoice: noop,
  handleOpenSend: noop,
};

describe("OrderInvoiceActions", () => {
  it("shows the advance + close buttons for an in-progress order", () => {
    render(<OrderInvoiceActions order={{ id: "o1", status: "Order Goods", paid: false }} {...BASE} />);
    expect(screen.getByText("Order Goods Complete →")).toBeTruthy();
    expect(screen.getByText("Close")).toBeTruthy();
    expect(screen.getByText("Mark Paid")).toBeTruthy();
  });

  it("shows Create Invoice for a completed order with no invoice", () => {
    render(<OrderInvoiceActions order={{ id: "o1", status: "Completed", paid: false }} {...BASE} nextStatus={null} />);
    expect(screen.getByText("Create Invoice")).toBeTruthy();
  });
});
