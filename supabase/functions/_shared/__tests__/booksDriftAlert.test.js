import { describe, it, expect } from "vitest";
import {
  findDriftRows,
  verifyDriftRow,
  summarizeBooksDrift,
  shouldSendBooksDriftAlert,
  buildBooksDriftAlertText,
  driftAckKey,
  driftCents,
  buildPriorAlertMap,
  selectUnalertedDrift,
  alertedSignatures,
} from "../booksDriftAlert.js";

describe("findDriftRows", () => {
  it("flags rows past tolerance, signed local-minus-qb", () => {
    const rows = findDriftRows([
      { shop_owner: "a@x.com", ref: "Q-1", total: 758.36, qb_total: 758.46 },
      { shop_owner: "b@x.com", ref: "Q-2", total: 196.23, qb_total: 181.25 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].drift).toBe(-0.1);
    expect(rows[1].drift).toBe(14.98);
  });

  it("ignores matches within a penny (rounding is not drift)", () => {
    expect(findDriftRows([{ shop_owner: "a", ref: "Q", total: 100.0, qb_total: 100.01 }])).toHaveLength(0);
    expect(findDriftRows([{ shop_owner: "a", ref: "Q", total: 100.0, qb_total: 100.0 }])).toHaveLength(0);
  });

  it("skips never-mirrored rows (null qb_total ≠ drift) and junk input", () => {
    expect(findDriftRows([{ shop_owner: "a", ref: "Q", total: 100, qb_total: null }])).toHaveLength(0);
    expect(findDriftRows([{ shop_owner: "a", ref: "Q", total: null, qb_total: 100 }])).toHaveLength(0);
    expect(findDriftRows(null)).toHaveLength(0);
  });

  it("handles numeric-string columns (Postgres numeric arrives as string)", () => {
    const rows = findDriftRows([{ shop_owner: "a", ref: "Q", total: "609.10", qb_total: "617.45" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].drift).toBe(-8.35);
  });
});

describe("verifyDriftRow (the Kato false-positive guard)", () => {
  const candidate = { shop_owner: "kato@x.com", ref: "Q-2026-TOOV", total: 1634.69, qb_total: 1185.28 };

  it("stale mirror: live QB now matches the row → NO alert, mirror patch refreshes", () => {
    // Kato's exact case: invoice born 1185.28, corrected in QBO to 1634.69
    // before payment; quote mirror frozen at birth value.
    const v = verifyDriftRow(candidate, { TotalAmt: 1634.69, TxnTaxDetail: { TotalTax: 124.69 } });
    expect(v.status).toBe("stale-mirror");
    expect(v.mirrorPatch.qb_total).toBe(1634.69);
    expect(v.mirrorPatch.qb_tax_amount).toBe(124.69);
    expect(v.mirrorPatch.qb_subtotal).toBe(1510);
  });

  it("confirmed: still diverges vs live QB → alert with LIVE total, not the mirror", () => {
    const v = verifyDriftRow(candidate, { TotalAmt: 1400.0, TxnTaxDetail: { TotalTax: 100 } });
    expect(v.status).toBe("confirmed");
    expect(v.row.qb_total).toBe(1400);
    expect(v.row.drift).toBe(234.69);
    expect(v.mirrorPatch.qb_total).toBe(1400);
  });

  it("missing in QB: deleted invoice is not drift (missing_in_qb owns that signal)", () => {
    expect(verifyDriftRow(candidate, null).status).toBe("missing-in-qb");
  });

  it("live match within tolerance counts as stale-mirror, not confirmed", () => {
    const v = verifyDriftRow(candidate, { TotalAmt: 1634.68, TxnTaxDetail: { TotalTax: 124.69 } });
    expect(v.status).toBe("stale-mirror");
  });
});

describe("summarizeBooksDrift + shouldSendBooksDriftAlert", () => {
  const drift = [{ shop_owner: "kato@x.com", ref: "Q-1", total: 1, qb_total: 2, drift: -1 }];
  const stuck = [{ shop_owner: "joe@x.com", invoice_id: "INV-1", order_id: "ORD-1" }];

  it("counts drift + stuck and distinct shops", () => {
    const s = summarizeBooksDrift({ quoteDrift: drift, invoiceDrift: drift, stuckOrders: stuck, taxHoldCount: 3 });
    expect(s.driftCount).toBe(2);
    expect(s.stuckCount).toBe(1);
    expect(s.shopCount).toBe(2);
    expect(s.taxHoldCount).toBe(3);
  });

  it("sends on drift alone or stuck alone", () => {
    expect(shouldSendBooksDriftAlert(summarizeBooksDrift({ quoteDrift: drift }))).toBe(true);
    expect(shouldSendBooksDriftAlert(summarizeBooksDrift({ stuckOrders: stuck }))).toBe(true);
  });

  it("does NOT send on tax holds alone — holds are the system working", () => {
    expect(shouldSendBooksDriftAlert(summarizeBooksDrift({ taxHoldCount: 5 }))).toBe(false);
  });

  it("does NOT send when clean", () => {
    expect(shouldSendBooksDriftAlert(summarizeBooksDrift({}))).toBe(false);
    expect(shouldSendBooksDriftAlert(null)).toBe(false);
  });
});

describe("buildBooksDriftAlertText", () => {
  it("lists every finding with shop, ref, and both totals", () => {
    const text = buildBooksDriftAlertText(summarizeBooksDrift({
      quoteDrift: [{ shop_owner: "kato@x.com", ref: "Q-2026-59B7", total: 758.36, qb_total: 758.46, drift: -0.1 }],
      stuckOrders: [{ shop_owner: "joe@x.com", invoice_id: "INV-1", order_id: "ORD-1" }],
      taxHoldCount: 2,
    }));
    expect(text).toContain("Q-2026-59B7");
    expect(text).toContain("$758.36");
    expect(text).toContain("$758.46");
    expect(text).toContain("INV-1");
    expect(text).toContain("ORD-1");
    expect(text).toContain("2 tax-mismatch hold(s)");
    expect(text).toContain("QB is the authority");
  });
});

describe("per-drift operator-alert dedup", () => {
  const kato = { shop_owner: "kato@thunder-house.com", ref: "Q-2026-9Q31", source: "quotes", drift: -84.96 };

  it("driftAckKey is stable per shop/ref/source; driftCents is signed integer cents", () => {
    expect(driftAckKey(kato)).toBe("kato@thunder-house.com|Q-2026-9Q31|quotes");
    expect(driftCents(kato)).toBe(-8496);
    expect(driftAckKey({ shop_owner: "a@x.com", ref: "R" })).toBe("a@x.com|R|quotes"); // defaults source
  });

  it("buildPriorAlertMap keeps the NEWEST amount when events replay oldest-first", () => {
    const map = buildPriorAlertMap([
      { alerted: [{ key: "a@x|Q1|quotes", cents: 100 }] },
      { alerted: [{ key: "a@x|Q1|quotes", cents: 250 }, { key: "b@x|I2|invoices", cents: -30 }] },
    ]);
    expect(map).toEqual({ "a@x|Q1|quotes": 250, "b@x|I2|invoices": -30 });
  });

  it("selectUnalertedDrift emits a never-seen row, suppresses an unchanged one, re-emits a changed one", () => {
    const rows = [
      { shop_owner: "a@x.com", ref: "Q1", source: "quotes", drift: 5.00 },   // never alerted
      { shop_owner: "b@x.com", ref: "I2", source: "invoices", drift: -3.00 }, // alerted, unchanged
      { shop_owner: "c@x.com", ref: "Q3", source: "quotes", drift: 9.99 },    // alerted, amount changed
    ];
    const prior = { "b@x.com|I2|invoices": -300, "c@x.com|Q3|quotes": 100 };
    const fresh = selectUnalertedDrift(rows, prior);
    expect(fresh.map((r) => r.ref)).toEqual(["Q1", "Q3"]);
  });

  it("Kato's persistent drift goes quiet after the first alert, until the amount changes", () => {
    const rows = [kato];
    // Night 1: nothing recorded → alert.
    let fresh = selectUnalertedDrift(rows, {});
    expect(fresh).toHaveLength(1);
    // Record what we alerted, replay into the map.
    const map = buildPriorAlertMap([{ alerted: alertedSignatures(fresh) }]);
    expect(map).toEqual({ "kato@thunder-house.com|Q-2026-9Q31|quotes": -8496 });
    // Night 2+: same drift → silent.
    expect(selectUnalertedDrift(rows, map)).toHaveLength(0);
    // QB changes the amount → re-alert once.
    expect(selectUnalertedDrift([{ ...kato, drift: -90.0 }], map)).toHaveLength(1);
  });

  it("alertedSignatures pairs each row's key with its cents", () => {
    expect(alertedSignatures([kato])).toEqual([
      { key: "kato@thunder-house.com|Q-2026-9Q31|quotes", cents: -8496 },
    ]);
  });
});
