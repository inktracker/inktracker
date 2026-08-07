import { describe, it, expect } from "vitest";
import { qbModifiedState, buildAdoptPatches, buildSyncNote, stripSyncNotes } from "../qbModifiedSync.js";

describe("qbModifiedState", () => {
  it("flags a row whose as-sold total disagrees with the QB mirror", () => {
    const s = qbModifiedState({ total: "19477.53", qb_total: "19777.53" });
    expect(s.modified).toBe(true);
    expect(s.delta).toBe(300);
  });

  it("clean rows and never-mirrored rows are not modified", () => {
    expect(qbModifiedState({ total: 100, qb_total: 100 }).modified).toBe(false);
    expect(qbModifiedState({ total: 100, qb_total: null }).modified).toBe(false);
    expect(qbModifiedState({ total: null, qb_total: 100 }).modified).toBe(false);
    expect(qbModifiedState(null).modified).toBe(false);
  });

  it("penny rounding is not a modification", () => {
    expect(qbModifiedState({ total: 100.0, qb_total: 100.01 }).modified).toBe(false);
  });
});

describe("buildAdoptPatches", () => {
  const invoice = { qb_total: 19777.53, qb_tax_amount: 1422.03, qb_subtotal: 18355.5 };

  it("adopts QB totals/tax onto invoice, quote, and order patches", () => {
    const p = buildAdoptPatches(invoice);
    expect(p.invoice).toMatchObject({ subtotal: 18355.5, tax: 1422.03, total: 19777.53, tax_rate: 7.7472 });
    expect(p.invoice.notes).toContain("Synced from QuickBooks");
    expect(p.quote.total).toBe(19777.53);
    expect(p.order.tax).toBe(1422.03);
  });

  it("derives subtotal when the mirror lacks it, and rate guards divide-by-zero", () => {
    const p = buildAdoptPatches({ qb_total: 108.27, qb_tax_amount: 8.27 });
    expect(p.invoice.subtotal).toBe(100);
    expect(p.invoice.tax_rate).toBe(8.27);
    const z = buildAdoptPatches({ qb_total: 0, qb_tax_amount: 0 });
    expect(z.invoice.tax_rate).toBe(0);
  });

  it("returns null without a usable qb_total", () => {
    expect(buildAdoptPatches({})).toBeNull();
    expect(buildAdoptPatches(null)).toBeNull();
  });

  it("discounted invoices keep their pre-discount subtotal (QB's is post-discount)", () => {
    const p = buildAdoptPatches({ ...invoice, discount: 10 });
    expect(p.invoice).not.toHaveProperty("subtotal");
    expect(p.invoice.total).toBe(19777.53);
    expect(p.invoice.tax).toBe(1422.03);
    const noDisc = buildAdoptPatches({ ...invoice, discount: 0 });
    expect(noDisc.invoice.subtotal).toBe(18355.5);
  });

  it("invoice patch records a dated sync note describing the change", () => {
    const p = buildAdoptPatches(
      { ...invoice, total: 19477.53, tax: 1422.03, notes: "rush job" },
      { today: "2026-07-18" },
    );
    expect(p.invoice.notes).toBe(
      "rush job\n[2026-07-18] Synced from QuickBooks: total $19477.53 → $19777.53",
    );
    // Quote/order patches carry no notes — the audit line lives on the invoice.
    expect(p.quote).not.toHaveProperty("notes");
    expect(p.order).not.toHaveProperty("notes");
  });
});

describe("buildSyncNote", () => {
  it("mentions tax only when it changed, and starts clean without prior notes", () => {
    const withTax = buildSyncNote({
      existingNotes: "", localTotal: 100, qbTotal: 110, localTax: 8, qbTax: 9, today: "2026-07-18",
    });
    expect(withTax).toBe("[2026-07-18] Synced from QuickBooks: total $100.00 → $110.00, tax $8.00 → $9.00");
    const sameTax = buildSyncNote({
      existingNotes: null, localTotal: 100, qbTotal: 110, localTax: 8, qbTax: 8, today: "2026-07-18",
    });
    expect(sameTax).not.toContain("tax");
  });

  it("repeated syncs stack as history lines", () => {
    const first = buildSyncNote({ existingNotes: "", localTotal: 100, qbTotal: 110, today: "2026-07-01" });
    const second = buildSyncNote({ existingNotes: first, localTotal: 110, qbTotal: 120, today: "2026-07-18" });
    expect(second.split("\n")).toHaveLength(2);
    expect(second).toContain("$100.00 → $110.00");
    expect(second).toContain("$110.00 → $120.00");
  });
});

describe("stripSyncNotes (customer-facing surfaces)", () => {
  it("removes sync lines, keeps the shop's real notes", () => {
    const notes = buildSyncNote({ existingNotes: "rush job — deliver by Friday", localTotal: 100, qbTotal: 110, today: "2026-07-18" });
    expect(stripSyncNotes(notes)).toBe("rush job — deliver by Friday");
  });

  it("returns empty when notes are ONLY sync lines (PDF omits the Notes block)", () => {
    const notes = buildSyncNote({ existingNotes: "", localTotal: 100, qbTotal: 110, today: "2026-07-18" });
    expect(stripSyncNotes(notes)).toBe("");
  });

  it("shop notes that merely mention QuickBooks survive", () => {
    expect(stripSyncNotes("Customer pays via QuickBooks link")).toBe("Customer pays via QuickBooks link");
  });

  it("round-trip: every line buildSyncNote produces is stripped", () => {
    const stacked = buildSyncNote({
      existingNotes: buildSyncNote({ existingNotes: "keep me", localTotal: 1, qbTotal: 2, today: "2026-07-01" }),
      localTotal: 2, qbTotal: 3, localTax: 0.1, qbTax: 0.3, today: "2026-07-18",
    });
    expect(stripSyncNotes(stacked)).toBe("keep me");
  });

  it("tolerates junk input", () => {
    expect(stripSyncNotes(null)).toBe("");
    expect(stripSyncNotes(undefined)).toBe("");
  });
});

// ── Push-pending precedence (Edit Order phase 2) ────────────────────────────
import { qbPushPending } from "../qbModifiedSync";

describe("qbPushPending suppresses the Match banner (direction guard)", () => {
  const edited = { qb_invoice_id: "77", qb_push_pending: true, total: 560, qb_total: 500 };

  it("flags only a QB-linked invoice with the pending marker", () => {
    expect(qbPushPending(edited)).toBe(true);
    expect(qbPushPending({ qb_push_pending: true })).toBe(false); // no QB invoice → nothing to push
    expect(qbPushPending({ qb_invoice_id: "77" })).toBe(false);
    expect(qbPushPending(null)).toBe(false);
  });

  it("qbModifiedState stays quiet while a push is pending — Match would revert the shop's own edit", () => {
    // Totals diverge (560 vs 500) but the divergence is OURS.
    expect(qbModifiedState(edited).modified).toBe(false);
    // Once the push clears the flag (qbSync write-back), normal Match
    // detection resumes for genuine QB-side edits.
    expect(qbModifiedState({ ...edited, qb_push_pending: false }).modified).toBe(true);
  });
});
