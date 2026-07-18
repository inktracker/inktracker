import { describe, it, expect } from "vitest";
import {
  detectQbInvoiceModification,
  detectQbPaidRegression,
  buildQbMirrorPatch,
  buildQbModifiedNotification,
<<<<<<< HEAD
  buildQbPaidRegressionNotification,
=======
  mergeNotesPreservingSyncLines,
>>>>>>> origin/main
} from "../qbInvoiceModified.js";

describe("detectQbInvoiceModification", () => {
  it("notifies on the transition: QB moved AND now disagrees with IT", () => {
    // Kato's $300 line: mirror had 19477.53, QB edit made it 19777.53, IT at 19477.53
    const d = detectQbInvoiceModification({ localTotal: 19477.53, priorQbTotal: 19477.53, freshQbTotal: 19777.53 });
    expect(d).toEqual({ qbChanged: true, diverges: true, shouldNotify: true });
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

  it("first mirror write never notifies (no prior to compare)", () => {
    const d = detectQbInvoiceModification({ localTotal: 100, priorQbTotal: null, freshQbTotal: 150 });
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
    expect(row.body).toContain("Sync from QuickBooks");
    expect(row.related_id).toBe("row-uuid");
    expect(row.metadata.qb_total).toBe(19777.53);
  });
});

<<<<<<< HEAD
// A deleted/unapplied/refunded payment in QBO reopens the Balance WITHOUT
// moving TotalAmt — the total-based detector stays silent, so this detector
// is the only signal before the books diverge permanently.
describe("detectQbPaidRegression", () => {
  it("fires when local says paid but QB shows an open balance again", () => {
    expect(detectQbPaidRegression({
      localPaid: true,
      freshInvoice: { TotalAmt: 68.21, Balance: 68.21 },
    })).toBe(true);
  });

  it("stays quiet when local isn't paid (normal unpaid invoice)", () => {
    expect(detectQbPaidRegression({
      localPaid: false,
      freshInvoice: { TotalAmt: 68.21, Balance: 68.21 },
    })).toBe(false);
  });

  it("stays quiet when QB still shows fully paid", () => {
    expect(detectQbPaidRegression({
      localPaid: true,
      freshInvoice: { TotalAmt: 68.21, Balance: 0 },
    })).toBe(false);
  });

  it("excludes voids that zero the total (covered by the modification detector)", () => {
    expect(detectQbPaidRegression({
      localPaid: true,
      freshInvoice: { TotalAmt: 0, Balance: 0 },
    })).toBe(false);
  });

  it("ignores sub-cent float noise in Balance", () => {
    expect(detectQbPaidRegression({
      localPaid: true,
      freshInvoice: { TotalAmt: 100, Balance: 0.005 },
    })).toBe(false);
  });

  it("handles a missing invoice payload without firing", () => {
    expect(detectQbPaidRegression({ localPaid: true, freshInvoice: null })).toBe(false);
  });
});

describe("buildQbPaidRegressionNotification", () => {
  it("builds a warning that says InkTracker did NOT un-pay", () => {
    const row = buildQbPaidRegressionNotification({
      shopOwner: "shop@x.com",
      ref: "Q-2026-GR55",
      rowId: "row-uuid",
      relatedEntity: "invoice",
      qbInvoiceId: "582",
      qbBalance: 68.21,
      qbTotal: 68.21,
    });
    expect(row.event_type).toBe("qb_payment_removed");
    expect(row.severity).toBe("warning");
    expect(row.title).toContain("Q-2026-GR55");
    expect(row.body).toContain("did NOT un-mark");
    expect(row.metadata.qb_balance).toBe(68.21);
=======
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
>>>>>>> origin/main
  });
});
