import { describe, it, expect } from "vitest";
import {
  EDIT_TIERS,
  getOrderEditTier,
  orderEditBlockers,
  orderEditWarnings,
  imprintsChanged,
  isStructuralLineChange,
  buildEditPatches,
  editConflict,
  appendNote,
} from "../editOrderEngine";

const line = (over = {}) => ({
  id: "li1", style: "1717", brand: "Comfort Colors",
  sizes: { M: 10, L: 5 }, imprints: [{ id: "imp1", location: "Front", technique: "Screen Print", colors: 2 }],
  ...over,
});

describe("getOrderEditTier", () => {
  it("walks the linked-document ladder, most-restrictive first", () => {
    expect(getOrderEditTier({ status: "Printing" }, null).tier).toBe(EDIT_TIERS.UNBILLED);
    expect(getOrderEditTier({ status: "Printing" }, { id: "inv" }).tier).toBe(EDIT_TIERS.INVOICED);
    expect(getOrderEditTier({ status: "Printing" }, { qb_invoice_id: "77" }).tier).toBe(EDIT_TIERS.IN_QB);
    expect(getOrderEditTier({ status: "Printing" }, { qb_invoice_id: "77", paid: true }).tier).toBe(EDIT_TIERS.PAID_OR_DONE);
    expect(getOrderEditTier({ status: "Completed" }, null).tier).toBe(EDIT_TIERS.PAID_OR_DONE);
  });
});

describe("orderEditBlockers — goods_progress is keyed by line index", () => {
  const order = {
    line_items: [line()],
    checklist: { goods_progress: { "0-M": { status: "received" }, "0-L": { status: "ordered" } } },
  };

  it("blocks structural line changes once goods are marked (index keys would mis-point)", () => {
    const blockers = orderEditBlockers(order, [line(), line({ id: "li2" })]);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("mis-point");
  });

  it("blocks reducing a RECEIVED size below its original count", () => {
    const blockers = orderEditBlockers(order, [line({ sizes: { M: 8, L: 5 } })]);
    expect(blockers.some((b) => b.includes("RECEIVED"))).toBe(true);
  });

  it("blocks removing a size that carries a mark", () => {
    const blockers = orderEditBlockers(order, [line({ sizes: { M: 10 } })]);
    expect(blockers.some((b) => b.includes("marked ordered"))).toBe(true);
  });

  it("allows INCREASING quantities and adding fresh sizes", () => {
    expect(orderEditBlockers(order, [line({ sizes: { M: 12, L: 5, XL: 3 } })])).toEqual([]);
  });

  it("no marks → structural changes are fine", () => {
    const free = { line_items: [line()], checklist: {} };
    expect(orderEditBlockers(free, [line(), line({ id: "li2" })])).toEqual([]);
  });

  it("shortfall can't exceed the new quantity", () => {
    const o = { line_items: [line({ _shortfall: { M: 4 } })], checklist: {} };
    const blockers = orderEditBlockers(o, [line({ _shortfall: { M: 4 }, sizes: { M: 3, L: 5 } })]);
    expect(blockers.some((b) => b.includes("shortfall"))).toBe(true);
  });
});

describe("warnings + art approval", () => {
  it("imprint change on an approved order warns and clears approval in the patch", () => {
    const order = { order_id: "ORD-1", art_approved: true, line_items: [line()], total: 500 };
    const editedLines = [line({ imprints: [{ id: "imp1", location: "Back", technique: "Screen Print", colors: 2 }] })];
    expect(imprintsChanged(order.line_items, editedLines)).toBe(true);
    expect(orderEditWarnings(order, editedLines, {}).some((w) => w.includes("re-approve"))).toBe(true);

    const { orderPatch, artApprovalCleared } = buildEditPatches({
      order, edited: { line_items: editedLines, customer_id: "c1", customer_name: "X", subtotal: 500, tax: 0, total: 500 },
      linkedInvoice: null, quote: null, today: "2026-08-06",
    });
    expect(artApprovalCleared).toBe(true);
    expect(orderPatch.art_approved).toBe(false);
  });

  it("quantity-only edits keep the approval", () => {
    const order = { art_approved: true, line_items: [line()], total: 500 };
    const editedLines = [line({ sizes: { M: 12, L: 5 } })];
    expect(imprintsChanged(order.line_items, editedLines)).toBe(false);
  });

  it("a source PO warns but never blocks", () => {
    const w = orderEditWarnings({ line_items: [line()] }, [line()], { sourcePO: { po_number: "PO-9" } });
    expect(w.some((x) => x.includes("NOT auto-edited"))).toBe(true);
  });
});

describe("buildEditPatches — decided policies", () => {
  const order = { order_id: "ORD-1", total: 500, notes: "", line_items: [line()] };
  const edited = { line_items: [line({ sizes: { M: 12, L: 5 } })], customer_id: "c1", customer_name: "X", subtotal: 560, tax: 0, total: 560 };

  it("tier 2: invoice auto-updates with the dated shop-facing note (decision #1)", () => {
    const inv = { id: "inv1", total: 500, notes: "existing note" };
    const { invoicePatch } = buildEditPatches({ order, edited, linkedInvoice: inv, quote: null, today: "2026-08-06" });
    expect(invoicePatch.total).toBe(560);
    expect(invoicePatch.notes).toBe("existing note\n[2026-08-06] Updated from order edit: total $500.00 → $560.00");
  });

  it("QB-linked or paid invoices are NEVER auto-patched (phase boundaries)", () => {
    expect(buildEditPatches({ order, edited, linkedInvoice: { qb_invoice_id: "7" }, quote: null, today: "2026-08-06" }).invoicePatch).toBeNull();
    expect(buildEditPatches({ order, edited, linkedInvoice: { paid: true }, quote: null, today: "2026-08-06" }).invoicePatch).toBeNull();
  });

  it("quote keep_historical (default): one marker note, added once, no money rewrite (decision #4)", () => {
    const quote = { total: 500, notes: "" };
    const first = buildEditPatches({ order, edited, linkedInvoice: null, quote, today: "2026-08-06" });
    expect(first.quotePatch.notes).toContain("reflects the ORIGINAL agreement");
    expect(first.quotePatch.line_items).toBeUndefined();
    // Second edit: marker already present → no repeat note.
    const again = buildEditPatches({ order, edited, linkedInvoice: null, quote: { ...quote, notes: first.quotePatch.notes }, today: "2026-08-07" });
    expect(again.quotePatch).toBeNull();
  });

  it("quote sync_to_order: lines/totals mirror with the dated note (decision #4)", () => {
    const quote = { total: 500, notes: "" };
    const { quotePatch } = buildEditPatches({ order, edited, linkedInvoice: null, quote, quoteSyncPolicy: "sync_to_order", today: "2026-08-06" });
    expect(quotePatch.total).toBe(560);
    expect(quotePatch.notes).toContain("Updated to match order edit: total $500.00 → $560.00");
  });

  it("reports the money delta for the confirm dialog", () => {
    expect(buildEditPatches({ order, edited, linkedInvoice: null, quote: null, today: "2026-08-06" }).moneyDelta).toBe(60);
  });
});

describe("editConflict (stale-write guard)", () => {
  const snap = { line_items: [line()], customer_id: "c1", due_date: "2026-08-10", job_title: "J", notes: "", total: 500, status: "Printing" };

  it("flags a concurrent edit to any tracked field", () => {
    expect(editConflict(snap, { ...snap, total: 480 })).toBe(true);
    expect(editConflict(snap, { ...snap, line_items: [line({ sizes: { M: 9, L: 5 } })] })).toBe(true);
  });

  it("ignores background qb_* mirror writes (untracked fields)", () => {
    expect(editConflict(snap, { ...snap, qb_total: 500, qb_synced_at: "now" })).toBe(false);
  });
});

describe("appendNote", () => {
  it("accumulates, never overwrites", () => {
    expect(appendNote("", "[d] a")).toBe("[d] a");
    expect(appendNote("prior", "[d] a")).toBe("prior\n[d] a");
  });
});
