import { describe, it, expect } from "vitest";
import {
  EDIT_TIERS,
  getOrderEditTier,
  orderEditBlockers,
  orderEditWarnings,
  imprintsChanged,
  isStructuralLineChange,
  buildEditPatches,
  tierCapabilities,
  editConflict,
  appendNote,
  recomputeOrderMoney,
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

  it("tier 3 (phase 2): QB-linked unpaid invoices auto-patch WITH qb_push_pending — local truth is newer", () => {
    const { invoicePatch } = buildEditPatches({ order, edited, linkedInvoice: { qb_invoice_id: "7", total: 500, notes: "" }, quote: null, today: "2026-08-06" });
    expect(invoicePatch.total).toBe(560);
    expect(invoicePatch.qb_push_pending).toBe(true);
    expect(invoicePatch.notes).toContain("Updated from order edit");
  });

  it("tier 2 invoices never carry the push flag (nothing to push)", () => {
    const { invoicePatch } = buildEditPatches({ order, edited, linkedInvoice: { id: "inv", total: 500, notes: "" }, quote: null, today: "2026-08-06" });
    expect(invoicePatch.qb_push_pending).toBeUndefined();
  });

  it("PAID invoices are never auto-patched (phase-3 boundary holds)", () => {
    expect(buildEditPatches({ order, edited, linkedInvoice: { paid: true }, quote: null, today: "2026-08-06" }).invoicePatch).toBeNull();
    expect(buildEditPatches({ order, edited, linkedInvoice: { qb_invoice_id: "7", paid: true }, quote: null, today: "2026-08-06" }).invoicePatch).toBeNull();
  });

  it("tierCapabilities: tier 3 edits but cannot switch customer; push required", () => {
    expect(tierCapabilities(EDIT_TIERS.INVOICED)).toEqual({ canEdit: true, canSwitchCustomer: true, pushRequired: false });
    expect(tierCapabilities(EDIT_TIERS.IN_QB)).toEqual({ canEdit: true, canSwitchCustomer: false, pushRequired: true });
    expect(tierCapabilities(EDIT_TIERS.PAID_OR_DONE).canEdit).toBe(false);
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

  it("fee fields ride every patch: order, invoice, and sync_to_order quote", () => {
    const charges = [{ id: "ac-1", label: "Screen fee", amount: 25, taxable: true }];
    const withFees = { ...edited, setup_total: 40, additional_charges: charges };
    const inv = { id: "inv1", total: 500, notes: "" };
    const quote = { total: 500, notes: "" };
    const { orderPatch, invoicePatch, quotePatch } = buildEditPatches({
      order, edited: withFees, linkedInvoice: inv, quote, quoteSyncPolicy: "sync_to_order", today: "2026-08-06",
    });
    expect(orderPatch.setup_total).toBe(40);
    expect(orderPatch.additional_charges).toEqual(charges);
    expect(invoicePatch.setup_total).toBe(40);
    expect(invoicePatch.additional_charges).toEqual(charges);
    expect(quotePatch.setup_total).toBe(40);
    expect(quotePatch.additional_charges).toEqual(charges);
  });

  it("removing every additional charge propagates the empty list (fee taken OFF, not left stale)", () => {
    const feeOrder = { ...order, setup_total: 40, additional_charges: [{ id: "ac-1", label: "Screen fee", amount: 25, taxable: true }] };
    const { orderPatch, invoicePatch } = buildEditPatches({
      order: feeOrder,
      edited: { ...edited, setup_total: 0, additional_charges: [] },
      linkedInvoice: { id: "inv1", total: 500, notes: "" }, quote: null, today: "2026-08-06",
    });
    expect(orderPatch.setup_total).toBe(0);
    expect(orderPatch.additional_charges).toEqual([]);
    expect(invoicePatch.additional_charges).toEqual([]);
  });

  it("edits that don't touch fees carry the order's existing values through", () => {
    const feeOrder = { ...order, setup_total: 40, additional_charges: [{ id: "ac-1", label: "Screen fee", amount: 25, taxable: true }] };
    const { orderPatch } = buildEditPatches({ order: feeOrder, edited, linkedInvoice: null, quote: null, today: "2026-08-06" });
    expect(orderPatch.setup_total).toBe(40);
    expect(orderPatch.additional_charges).toEqual(feeOrder.additional_charges);
  });
});

describe("editConflict (stale-write guard)", () => {
  const snap = { line_items: [line()], customer_id: "c1", due_date: "2026-08-10", job_title: "J", notes: "", total: 500, status: "Printing" };

  it("flags a concurrent edit to any tracked field", () => {
    expect(editConflict(snap, { ...snap, total: 480 })).toBe(true);
    expect(editConflict(snap, { ...snap, line_items: [line({ sizes: { M: 9, L: 5 } })] })).toBe(true);
  });

  it("flags concurrent fee edits even when the total happens to match", () => {
    expect(editConflict(snap, { ...snap, setup_total: 40 })).toBe(true);
    expect(editConflict(snap, { ...snap, additional_charges: [{ id: "ac-1", label: "Rush", amount: 10, taxable: true }] })).toBe(true);
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


describe("recomputeOrderMoney — clientPpp override (Kato 2026-08-11)", () => {
  // Stub engine: always prices $17.40/pc so an ignored override is loud.
  const deps = {
    calcLinkedLinePrice: (li) => {
      const qty = Object.values(li.sizes || {}).reduce((s, n) => s + n, 0);
      return { ppp: 17.4, lineTotal: 17.4 * qty, rushFee: 0 };
    },
    buildLinkedQtyMap: () => ({}),
    getLineExtras: () => ({}),
    getQty: (li) => Object.values(li.sizes || {}).reduce((s, n) => s + n, 0),
  };
  const order = { rush_rate: 0, discount: 0, discount_type: "percent", setup_total: 0, additional_charges: [], tax_rate: 0 };

  it("a typed per-piece price survives save (engine does not re-stamp it)", () => {
    const lines = [{ sizes: { M: 10 }, clientPpp: 9.73 }];
    const { stamped, subtotal, total } = recomputeOrderMoney(lines, order, deps);
    expect(stamped[0]._ppp).toBe(9.73);
    expect(stamped[0]._lineTotal).toBe(97.3);
    expect(stamped[0]._rushFee).toBe(0);
    expect(subtotal).toBe(97.3);
    expect(total).toBe(97.3);
  });

  it("lines without an override still get fresh engine stamps", () => {
    const lines = [{ sizes: { M: 10 } }, { sizes: { L: 4 }, clientPpp: 0 }];
    const { stamped, subtotal } = recomputeOrderMoney(lines, order, deps);
    expect(stamped[0]._ppp).toBe(17.4);
    expect(stamped[1]._ppp).toBe(17.4); // clientPpp 0 = no override
    expect(subtotal).toBe(Number((17.4 * 14).toFixed(2)));
  });

  it("mixed lines: override and engine prices sum with discount + tax", () => {
    const lines = [{ sizes: { M: 10 }, clientPpp: 9.73 }, { sizes: { L: 10 } }];
    const o = { ...order, tax_rate: 10 };
    const { subtotal, tax, total } = recomputeOrderMoney(lines, o, deps);
    expect(subtotal).toBe(Number((97.3 + 174).toFixed(2)));
    expect(tax).toBe(Number((subtotal * 0.1).toFixed(2)));
    expect(total).toBe(Number((subtotal + tax).toFixed(2)));
  });

  it("fees param overrides the order's own fee fields (the editable draft wins)", () => {
    const lines = [{ sizes: { M: 10 } }]; // 174.00
    const o = { ...order, setup_total: 40, additional_charges: [{ id: "ac-1", label: "Screen fee", amount: 25, taxable: true }], tax_rate: 10 };
    const kept = recomputeOrderMoney(lines, o, deps);
    expect(kept.total).toBe(Number(((174 + 40 + 25) * 1.1).toFixed(2)));
    // Draft removed both fees → they're OUT of the new agreement.
    const removed = recomputeOrderMoney(lines, o, deps, { setup_total: 0, additional_charges: [] });
    expect(removed.setup).toBe(0);
    expect(removed.addl.total).toBe(0);
    expect(removed.total).toBe(Number((174 * 1.1).toFixed(2)));
  });

  it("taxable/non-taxable split matches the app-wide contract (non-taxable added AFTER tax)", () => {
    const lines = [{ sizes: { M: 10 } }]; // 174.00
    const o = { ...order, tax_rate: 10 };
    const fees = {
      setup_total: 0,
      additional_charges: [
        { id: "a", label: "Rush", amount: 50, taxable: true },
        { id: "b", label: "Shipping", amount: 30, taxable: false },
      ],
    };
    const { tax, total } = recomputeOrderMoney(lines, o, deps, fees);
    expect(tax).toBe(Number(((174 + 50) * 0.1).toFixed(2)));
    expect(total).toBe(Number((174 + 50 + tax + 30).toFixed(2)));
  });
});
