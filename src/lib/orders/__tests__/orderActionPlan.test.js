import { describe, it, expect } from "vitest";
import { buildOrderActionPlan } from "../orderActionPlan";

const ALL = {
  onRevert: true, onAdvance: true, onShowInvoice: true, onComplete: true,
  onTogglePaid: true, handleResyncInvoice: true, onCreateSlip: true,
  onPrintTicket: true, onEditOrder: true,
};
const keys = (plan) => plan.menu.map((m) => m.key);

describe("buildOrderActionPlan — one primary per state", () => {
  it("mid-production: primary = finish the current stage", () => {
    const p = buildOrderActionPlan({
      order: { status: "Printing" }, prevStatus: "Pre-Press", nextStatus: "Completed", has: ALL,
    });
    expect(p.primary).toMatchObject({ key: "advance", label: "Finish Printing →", disabled: false });
  });

  it("Completed with no invoice: primary = Create Invoice (& finish after a floor completion)", () => {
    const base = { order: { status: "Completed" }, relatedInvoice: null, has: ALL };
    expect(buildOrderActionPlan(base).primary).toMatchObject({ key: "createInvoice", label: "Create Invoice" });
    expect(buildOrderActionPlan({ ...base, order: { status: "Completed", floor_completed_at: "x" } }).primary.label)
      .toBe("Create Invoice & finish");
  });

  it("Completed with invoice: primary = Send Invoice (Receipt once paid)", () => {
    const inv = { id: "i1" };
    expect(buildOrderActionPlan({ order: { status: "Completed" }, relatedInvoice: inv, has: ALL }).primary)
      .toMatchObject({ key: "send", label: "Send Invoice" });
    expect(buildOrderActionPlan({ order: { status: "Completed", paid: true }, relatedInvoice: inv, has: ALL }).primary.label)
      .toBe("Send Receipt");
  });

  it("readOnly disables the primary but keeps it visible with the reactivate tooltip", () => {
    const p = buildOrderActionPlan({
      order: { status: "Printing" }, nextStatus: "Completed", readOnly: true, has: ALL,
    });
    expect(p.primary.disabled).toBe(true);
    expect(p.primary.title).toMatch(/reactivate/i);
  });
});

describe("buildOrderActionPlan — menu gates (must match the old bar exactly)", () => {
  it("Preview Invoice + View in QB appear at ANY status when a QB-linked invoice exists", () => {
    const p = buildOrderActionPlan({
      order: { status: "Printing" }, nextStatus: "Completed",
      relatedInvoice: { id: "i1", qb_invoice_id: "42" }, has: ALL,
    });
    expect(keys(p)).toContain("previewInvoice");
    const qb = p.menu.find((m) => m.key === "viewQb");
    expect(qb.href).toContain("txnId=42");
  });

  it("Create Slip only at Completed; Print Ticket at every status", () => {
    const mid = buildOrderActionPlan({ order: { status: "Printing" }, nextStatus: "Completed", has: ALL });
    expect(keys(mid)).toContain("printTicket");
    expect(keys(mid)).not.toContain("createSlip");
    const done = buildOrderActionPlan({ order: { status: "Completed" }, relatedInvoice: { id: "i" }, has: ALL });
    expect(keys(done)).toContain("createSlip");
  });

  it("revert appears only when a previous status + handler exist", () => {
    const noPrev = buildOrderActionPlan({ order: { status: "Art Approval" }, nextStatus: "Order Goods", has: ALL });
    expect(keys(noPrev)).not.toContain("revert");
    const withPrev = buildOrderActionPlan({ order: { status: "Printing" }, prevStatus: "Pre-Press", nextStatus: "Completed", has: ALL });
    expect(withPrev.menu.find((m) => m.key === "revert").label).toBe("← Back to Pre-Press");
  });

  it("Edit Order carries its disabled reason through", () => {
    const p = buildOrderActionPlan({
      order: { status: "Completed" }, relatedInvoice: { id: "i" },
      editOrderDisabledReason: "This order is paid.", has: ALL,
    });
    const edit = p.menu.find((m) => m.key === "editOrder");
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("This order is paid.");
  });

  it("handlers the parent didn't thread in never produce menu items", () => {
    const p = buildOrderActionPlan({ order: { status: "Completed" }, relatedInvoice: { id: "i" }, has: { onShowInvoice: true } });
    expect(keys(p)).toEqual(["previewInvoice"]);
    // Send isn't handler-gated (handleOpenSend is always threaded by the
    // modal), so with an invoice at Completed the primary is still send.
    expect(p.primary.key).toBe("send");
  });
});

describe("buildOrderActionPlan — utility + danger sections (old footer row 2)", () => {
  const FULL = { ...ALL, copyLink: true, onPreviewPdf: true, onSendToPartner: true, onDelete: true };

  it("share links keep the menu open and swap to Copied!", () => {
    const p = buildOrderActionPlan({ order: { status: "Printing" }, nextStatus: "Completed", copied: "art", has: FULL });
    const art = p.menu.find((m) => m.key === "artLink");
    expect(art.keepOpen).toBe(true);
    expect(art.label).toBe("Copied!");
    expect(p.menu.find((m) => m.key === "statusLink").label).toBe("Copy Status Link");
  });

  it("Delete is last, danger-flagged, and disabled under readOnly", () => {
    const p = buildOrderActionPlan({ order: { status: "Completed" }, relatedInvoice: { id: "i" }, readOnly: true, has: FULL });
    const last = p.menu[p.menu.length - 1];
    expect(last.key).toBe("delete");
    expect(last.danger).toBe(true);
    expect(last.disabled).toBe(true);
  });

  it("Send to Partner only when the parent threaded the handler (role/readOnly gate lives upstream)", () => {
    const without = buildOrderActionPlan({ order: { status: "Printing" }, nextStatus: "Completed", has: ALL });
    expect(without.menu.some((m) => m.key === "sendToPartner")).toBe(false);
    const withIt = buildOrderActionPlan({ order: { status: "Printing" }, nextStatus: "Completed", has: FULL });
    expect(withIt.menu.some((m) => m.key === "sendToPartner")).toBe(true);
  });

  it("dividers separate workflow / utility / danger", () => {
    const p = buildOrderActionPlan({ order: { status: "Completed" }, relatedInvoice: { id: "i" }, has: FULL });
    expect(p.menu.filter((m) => m.divider).length).toBe(2);
  });
});
