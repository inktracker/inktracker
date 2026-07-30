import { describe, it, expect } from "vitest";
import {
  detectQbInvoiceModification,
  buildQbMirrorPatch,
  buildQbLineSnapshot,
  diffQbLineSnapshots,
  buildQbModifiedNotification,
  mergeNotesPreservingSyncLines,
} from "../qbInvoiceModified.js";

// A QB invoice line as QBO returns it — one flat Description string.
const qbLine = (id, desc, qty, amount) => ({
  Id: id,
  DetailType: "SalesItemLineDetail",
  Description: desc,
  Amount: amount,
  SalesItemLineDetail: { Qty: qty },
});

describe("buildQbLineSnapshot", () => {
  it("captures id/description/qty/amount for sales lines only", () => {
    const snap = buildQbLineSnapshot({
      Line: [
        qbLine("1", "Comfort Colors 9360 Blue Spruce | S:1, M:2", 12, 183.05),
        { Id: "2", DetailType: "DiscountLineDetail", Amount: 90 },
        { Id: "3", DetailType: "SubTotalLineDetail", Amount: 500 },
      ],
    });
    expect(snap).toEqual([
      { i: "1", d: "Comfort Colors 9360 Blue Spruce | S:1, M:2", q: 12, a: 183.05 },
    ]);
  });

  it("tolerates a missing/!array Line", () => {
    expect(buildQbLineSnapshot({})).toEqual([]);
    expect(buildQbLineSnapshot(null)).toEqual([]);
  });
});

describe("diffQbLineSnapshots", () => {
  const before = [{ i: "1", d: "Comfort Colors 9360 Black", q: 12, a: 183.05 }];

  it("names a garment-color edit made in QuickBooks", () => {
    const after = [{ i: "1", d: "Comfort Colors 9360 Gray", q: 12, a: 183.05 }];
    const changes = diffQbLineSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("Black");
    expect(changes[0]).toContain("Gray");
  });

  it("catches quantity and amount moves", () => {
    const after = [{ i: "1", d: "Comfort Colors 9360 Black", q: 14, a: 213.05 }];
    expect(diffQbLineSnapshots(before, after)).toEqual([
      "Line 1 quantity: 12 → 14",
      "Line 1 amount: $183.05 → $213.05",
    ]);
  });

  it("reports added and removed lines", () => {
    expect(diffQbLineSnapshots(before, [
      ...before,
      { i: "2", d: "Hoodies", q: 10, a: 194.92 },
    ])[0]).toContain("added in QuickBooks");
    expect(diffQbLineSnapshots(before, [])[0]).toContain("removed in QuickBooks");
  });

  it("is quiet when nothing moved, and when there's no prior snapshot", () => {
    expect(diffQbLineSnapshots(before, [...before])).toEqual([]);
    expect(diffQbLineSnapshots(null, before)).toEqual([]);
  });

  it("falls back to position when QB reissues line ids", () => {
    const after = [{ i: "99", d: "Comfort Colors 9360 Gray", q: 12, a: 183.05 }];
    const changes = diffQbLineSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain("description");
  });

  it("ignores sub-penny amount noise", () => {
    expect(diffQbLineSnapshots(before, [{ ...before[0], a: 183.055 }])).toEqual([]);
  });
});

describe("detectQbInvoiceModification", () => {
  it("notifies on the transition: QB moved AND now disagrees with IT", () => {
    // Kato's $300 line: mirror had 19477.53, QB edit made it 19777.53, IT at 19477.53
    const d = detectQbInvoiceModification({ localTotal: 19477.53, priorQbTotal: 19477.53, freshQbTotal: 19777.53 });
    expect(d).toEqual({
      qbChanged: true, diverges: true, firstMirror: false,
      lineChanges: [], linesChanged: false, shouldNotify: true,
    });
  });

  it("stays quiet when QB edit brings QB INTO agreement (the Kato correction case)", () => {
    // Invoice born wrong at 1185.28, shop fixes it in QBO to match the 1634.69 quote
    const d = detectQbInvoiceModification({ localTotal: 1634.69, priorQbTotal: 1185.28, freshQbTotal: 1634.69 });
    expect(d.qbChanged).toBe(true);
    expect(d.shouldNotify).toBe(false);
  });

  it("stays quiet on redelivered webhooks (QB total unchanged)", () => {
    const d = detectQbInvoiceModification({ localTotal: 100, priorQbTotal: 150, freshQbTotal: 150 });
    expect(d.qbChanged).toBe(false);
    expect(d.shouldNotify).toBe(false);
    expect(d.diverges).toBe(true); // still divergent, but not NEW news
  });

  // Regression: Lisa Gotts INV-2026-OW0M1-r3 / QB 3746, 2026-07-28.
  // Import-born rows (pullInvoices writes `total` but never `qb_total`)
  // reach their first QB-side edit with priorQbTotal = null. The old
  // first-mirror guard suppressed exactly that notification, so prod
  // had zero qb_invoice_modified rows ever written.
  it("first mirror that lands in DISAGREEMENT notifies (import-born rows)", () => {
    const d = detectQbInvoiceModification({ localTotal: 5000, priorQbTotal: null, freshQbTotal: 4995 });
    expect(d.firstMirror).toBe(true);
    expect(d.qbChanged).toBe(false);
    expect(d.diverges).toBe(true);
    expect(d.shouldNotify).toBe(true);
  });

  it("first mirror that AGREES stays quiet (untouched imported invoice)", () => {
    // pullInvoices sets local `total` from the QB total, so a freshly
    // imported invoice agrees on its first mirror — no noise.
    const d = detectQbInvoiceModification({ localTotal: 4995, priorQbTotal: null, freshQbTotal: 4995 });
    expect(d.firstMirror).toBe(true);
    expect(d.diverges).toBe(false);
    expect(d.shouldNotify).toBe(false);
  });

  it("first mirror with no local total to compare stays quiet", () => {
    const d = detectQbInvoiceModification({ localTotal: null, priorQbTotal: null, freshQbTotal: 150 });
    expect(d.shouldNotify).toBe(false);
  });

  // Joe's black→gray case: the shop retypes a garment color in QBO and
  // the invoice total never moves. Total-only detection said nothing.
  it("notifies on a line edit even when the total is unchanged", () => {
    const d = detectQbInvoiceModification({
      localTotal: 500,
      priorQbTotal: 500,
      freshQbTotal: 500,
      priorLines: [{ i: "1", d: "Comfort Colors 9360 Black", q: 12, a: 500 }],
      freshLines: [{ i: "1", d: "Comfort Colors 9360 Gray", q: 12, a: 500 }],
    });
    expect(d.qbChanged).toBe(false);
    expect(d.diverges).toBe(false);
    expect(d.linesChanged).toBe(true);
    expect(d.shouldNotify).toBe(true);
    expect(d.lineChanges[0]).toContain("Gray");
  });

  it("identical lines and identical totals stay quiet", () => {
    const lines = [{ i: "1", d: "Comfort Colors 9360 Black", q: 12, a: 500 }];
    const d = detectQbInvoiceModification({
      localTotal: 500, priorQbTotal: 500, freshQbTotal: 500,
      priorLines: lines, freshLines: [...lines],
    });
    expect(d.shouldNotify).toBe(false);
  });

  it("tolerates junk fresh totals", () => {
    expect(detectQbInvoiceModification({ localTotal: 100, priorQbTotal: 100, freshQbTotal: null }).shouldNotify).toBe(false);
    expect(detectQbInvoiceModification({ localTotal: 100, priorQbTotal: 100, freshQbTotal: "abc" }).shouldNotify).toBe(false);
  });

  it("penny-level movement is not a modification", () => {
    const d = detectQbInvoiceModification({ localTotal: 100, priorQbTotal: 100.0, freshQbTotal: 100.01 });
    expect(d.qbChanged).toBe(false);
  });
});

describe("buildQbMirrorPatch", () => {
  const fresh = {
    TotalAmt: 19777.53,
    TxnTaxDetail: { TotalTax: 1422.03 },
    Balance: 0,
  };

  it("mirrors money state without touching as-sold fields", () => {
    const p = buildQbMirrorPatch(fresh, { paid: true });
    expect(p.qb_total).toBe(19777.53);
    expect(p.qb_tax_amount).toBe(1422.03);
    expect(p.qb_subtotal).toBe(18355.5);
    expect(p.qb_synced_at).toBeTruthy();
    expect(p).not.toHaveProperty("total");
    expect(p).not.toHaveProperty("tax");
    expect(p).not.toHaveProperty("line_items");
  });

  it("flips paid forward when QB shows fully paid and row is unpaid", () => {
    const p = buildQbMirrorPatch(fresh, { paid: false });
    expect(p.paid).toBe(true);
    expect(p.paid_date).toBeTruthy();
  });

  it("never un-pays and never sets paid on rows without a paid column (quotes)", () => {
    expect(buildQbMirrorPatch(fresh, { paid: true })).not.toHaveProperty("paid");
    expect(buildQbMirrorPatch(fresh, {})).not.toHaveProperty("paid");
  });

  it("unpaid QB invoice does not flip paid", () => {
    const p = buildQbMirrorPatch({ ...fresh, Balance: 500 }, { paid: false });
    expect(p).not.toHaveProperty("paid");
  });

  it("null invoice → null patch", () => {
    expect(buildQbMirrorPatch(null, {})).toBeNull();
  });
});

describe("buildQbModifiedNotification", () => {
  it("builds a warning notification with both totals and deep-link fields", () => {
    const row = buildQbModifiedNotification({
      shopOwner: "kato@thunder-house.com",
      ref: "Q-2026-CT5D",
      rowId: "row-uuid",
      relatedEntity: "invoice",
      qbInvoiceId: "1903",
      localTotal: 19477.53,
      freshQbTotal: 19777.53,
    });
    expect(row.event_type).toBe("qb_invoice_modified");
    expect(row.severity).toBe("warning");
    expect(row.title).toContain("Q-2026-CT5D");
    expect(row.body).toContain("$19777.53");
    // Must name the button as it is actually labelled in
    // InvoiceDetailModal — the old copy said "Sync from QuickBooks",
    // which no longer exists anywhere in the UI.
    expect(row.body).toContain("Match to QuickBooks");
    expect(row.related_id).toBe("row-uuid");
    expect(row.metadata.qb_total).toBe(19777.53);
  });
});

describe("mergeNotesPreservingSyncLines (pullInvoices notes overwrite)", () => {
  const syncLine = "[2026-07-18] Synced from QuickBooks: total $100.00 → $110.00";

  it("keeps local sync-audit lines under QB's fresh memo", () => {
    const merged = mergeNotesPreservingSyncLines("thanks for your business", `old memo\n${syncLine}`);
    expect(merged).toBe(`thanks for your business\n${syncLine}`);
  });

  it("drops non-sync local notes (QB memo is authoritative for prose)", () => {
    expect(mergeNotesPreservingSyncLines("new memo", "old local prose")).toBe("new memo");
  });

  it("no memo + only sync lines → sync lines survive alone", () => {
    expect(mergeNotesPreservingSyncLines(null, syncLine)).toBe(syncLine);
  });

  it("nothing on either side → null (matches prior CustomerMemo || null shape)", () => {
    expect(mergeNotesPreservingSyncLines(null, null)).toBeNull();
    expect(mergeNotesPreservingSyncLines("", "")).toBeNull();
  });
});
