// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// pdfExport lazy-loads jspdf; stub the module so the import graph stays light.
vi.mock("../../../shared/pdfExport", () => ({
  exportOrderToPDF: () => Promise.resolve(null),
  previewPdf: () => {},
}));

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
  onDelete: noop,
  copyLink: noop,
  copied: null,
  customer: {},
  shopName: "Ink Shop",
  logoUrl: "",
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

const renderBar = (props) =>
  render(
    <MemoryRouter>
      <OrderInvoiceActions {...BASE} {...props} />
    </MemoryRouter>,
  );

describe("OrderInvoiceActions — one next step + More", () => {
  it("in-progress order: ONE primary (finish stage) + More + Close — no button wall", () => {
    renderBar({ order: { id: "o1", status: "Order Goods", paid: false } });
    expect(screen.getByText("Finish Order Goods →")).toBeTruthy();
    expect(screen.getByText("More")).toBeTruthy();
    expect(screen.getByText("Close")).toBeTruthy();
    // Secondary actions are NOT rendered until the menu opens.
    expect(screen.queryByText("Mark Paid")).toBeNull();
    expect(screen.queryByText("Delete Order")).toBeNull();
  });

  it("the More menu holds the old rows' actions (revert, paid, links, delete)", () => {
    renderBar({ order: { id: "o1", status: "Order Goods", paid: false } });
    fireEvent.click(screen.getByText("More"));
    expect(screen.getByText("← Back to Pre-Press")).toBeTruthy();
    expect(screen.getByText("Mark Paid")).toBeTruthy();
    expect(screen.getByText("Copy Art Approval Link")).toBeTruthy();
    expect(screen.getByText("Preview Order PDF")).toBeTruthy();
    expect(screen.getByText("Delete Order")).toBeTruthy();
  });

  it("Completed + no invoice: primary = Create Invoice", () => {
    renderBar({ order: { id: "o1", status: "Completed", paid: false }, nextStatus: null });
    expect(screen.getByText("Create Invoice")).toBeTruthy();
  });

  it("Completed + invoice: primary = Send Invoice; QB link in the menu", () => {
    renderBar({
      order: { id: "o1", status: "Completed", paid: false },
      nextStatus: null,
      relatedInvoice: { id: "i1", qb_invoice_id: "42" },
    });
    expect(screen.getByText("Send Invoice")).toBeTruthy();
    fireEvent.click(screen.getByText("More"));
    expect(screen.getByText("View in QuickBooks").getAttribute("href")).toContain("txnId=42");
  });

  it("Order Goods stage keeps the Create PO button inline (the stage's real work)", () => {
    renderBar({
      order: { id: "o1", status: "Order Goods", paid: false },
      liveOrder: { status: "Order Goods" },
      onOrderFromAC: noop,
      sourcePO: null,
    });
    expect(screen.getByText("Create PO")).toBeTruthy();
  });
});
