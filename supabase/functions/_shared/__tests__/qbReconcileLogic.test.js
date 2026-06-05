import { describe, it, expect } from "vitest";
import {
  classifyQuoteDrift,
  buildReconcileNotification,
  summarizeReconciliation,
  DRIFT_KINDS,
} from "../qbReconcileLogic.js";

const goodQuote = {
  id: "q-1", quote_id: "Q-2026-100", shop_owner: "shop@x.com",
  qb_invoice_id: "1042", qb_total: 250, paid: false,
};

// ─────────────────────────────────────────────────────────────────────
// classifyQuoteDrift
// ─────────────────────────────────────────────────────────────────────

describe("classifyQuoteDrift (CQD)", () => {
  it("CQD1 — null invoice → MISSING_IN_QB", () => {
    expect(classifyQuoteDrift(null, goodQuote).kind).toBe(DRIFT_KINDS.MISSING_IN_QB);
  });

  it("CQD2 — quote missing id → INVALID", () => {
    expect(classifyQuoteDrift({ TotalAmt: 250, Balance: 0 }, { shop_owner: "x" }).kind)
      .toBe(DRIFT_KINDS.INVALID);
  });

  it("CQD3 — QB paid, quote not → PAID_NOT_RECORDED", () => {
    const inv = { TotalAmt: 250, Balance: 0 };
    expect(classifyQuoteDrift(inv, goodQuote).kind).toBe(DRIFT_KINDS.PAID_NOT_RECORDED);
  });

  it("CQD4 — QB paid + quote already paid → OK (no double-convert)", () => {
    const inv = { TotalAmt: 250, Balance: 0 };
    expect(classifyQuoteDrift(inv, { ...goodQuote, paid: true }).kind).toBe(DRIFT_KINDS.OK);
  });

  it("CQD5 — totals match (1¢ tolerance) → OK", () => {
    expect(classifyQuoteDrift({ TotalAmt: 250.005, Balance: 250 }, goodQuote).kind).toBe(DRIFT_KINDS.OK);
    expect(classifyQuoteDrift({ TotalAmt: 250.00,  Balance: 250 }, goodQuote).kind).toBe(DRIFT_KINDS.OK);
    expect(classifyQuoteDrift({ TotalAmt: 249.99,  Balance: 249.99 }, goodQuote).kind).toBe(DRIFT_KINDS.OK);
  });

  it("CQD6 — totals diverge beyond 1¢ → TOTALS_DRIFT with numbers", () => {
    const inv = { TotalAmt: 275.00, Balance: 275 };
    const out = classifyQuoteDrift(inv, goodQuote);
    expect(out.kind).toBe(DRIFT_KINDS.TOTALS_DRIFT);
    expect(out.drift.storedTotal).toBe(250);
    expect(out.drift.qbTotal).toBe(275);
    expect(out.drift.driftCents).toBe(2500);
  });

  it("CQD7 — paid takes precedence over totals drift", () => {
    // QB shows totally different total AND paid — paid wins. We want
    // to convert first and let the operator reconcile after.
    const inv = { TotalAmt: 999, Balance: 0 };
    expect(classifyQuoteDrift(inv, goodQuote).kind).toBe(DRIFT_KINDS.PAID_NOT_RECORDED);
  });

  it("CQD8 — quote with no qb_total stored → skip drift check (returns OK on unpaid match)", () => {
    // Pre-PR-A quotes don't have qb_total. Don't compare against 0
    // and trigger a false-positive on every legacy quote.
    const inv = { TotalAmt: 250, Balance: 250 };
    const q = { ...goodQuote, qb_total: undefined };
    expect(classifyQuoteDrift(inv, q).kind).toBe(DRIFT_KINDS.OK);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildReconcileNotification
// ─────────────────────────────────────────────────────────────────────

describe("buildReconcileNotification (BRN)", () => {
  it("BRN1 — OK → null (no notification)", () => {
    const c = { kind: DRIFT_KINDS.OK, reason: "match" };
    expect(buildReconcileNotification({ shopOwner: "x", quote: goodQuote, classification: c }))
      .toBe(null);
  });

  it("BRN2 — INVALID → null", () => {
    const c = { kind: DRIFT_KINDS.INVALID, reason: "x" };
    expect(buildReconcileNotification({ shopOwner: "x", quote: goodQuote, classification: c }))
      .toBe(null);
  });

  it("BRN3 — PAID_NOT_RECORDED → info notification with auto-convert messaging", () => {
    const c = { kind: DRIFT_KINDS.PAID_NOT_RECORDED, reason: "Balance=0" };
    const n = buildReconcileNotification({ shopOwner: "shop@x.com", quote: goodQuote, classification: c });
    expect(n.severity).toBe("info");
    expect(n.event_type).toBe("qb_reconcile_paid_converted");
    expect(n.title).toMatch(/Q-2026-100/);
    expect(n.metadata.qb_invoice_id).toBe("1042");
  });

  it("BRN4 — TOTALS_DRIFT → warning notification with both amounts", () => {
    const c = {
      kind: DRIFT_KINDS.TOTALS_DRIFT,
      reason: "x",
      drift: { storedTotal: 250, qbTotal: 275, driftCents: 2500 },
    };
    const n = buildReconcileNotification({ shopOwner: "shop@x.com", quote: goodQuote, classification: c });
    expect(n.severity).toBe("warning");
    expect(n.event_type).toBe("qb_reconcile_totals_drift");
    expect(n.body).toMatch(/\$250\.00/);
    expect(n.body).toMatch(/\$275\.00/);
    expect(n.metadata.stored_total).toBe(250);
    expect(n.metadata.qb_total).toBe(275);
  });

  it("BRN5 — MISSING_IN_QB → warning notification, points operator to Link/Re-sync", () => {
    const c = { kind: DRIFT_KINDS.MISSING_IN_QB, reason: "not found" };
    const n = buildReconcileNotification({ shopOwner: "shop@x.com", quote: goodQuote, classification: c });
    expect(n.severity).toBe("warning");
    expect(n.event_type).toBe("qb_reconcile_missing_in_qb");
    expect(n.body).toMatch(/Link Existing|Re-sync/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// summarizeReconciliation
// ─────────────────────────────────────────────────────────────────────

describe("summarizeReconciliation (SR)", () => {
  it("SR1 — empty input → zero counts", () => {
    const s = summarizeReconciliation([]);
    expect(s).toEqual({
      total: 0, ok: 0, paid_not_recorded: 0, totals_drift: 0,
      missing_in_qb: 0, invalid: 0, errors: 0,
    });
  });

  it("SR2 — counts each kind correctly", () => {
    const s = summarizeReconciliation([
      { kind: DRIFT_KINDS.OK },
      { kind: DRIFT_KINDS.OK },
      { kind: DRIFT_KINDS.PAID_NOT_RECORDED },
      { kind: DRIFT_KINDS.TOTALS_DRIFT },
      { kind: DRIFT_KINDS.MISSING_IN_QB },
      { kind: DRIFT_KINDS.INVALID },
    ]);
    expect(s.total).toBe(6);
    expect(s.ok).toBe(2);
    expect(s.paid_not_recorded).toBe(1);
    expect(s.totals_drift).toBe(1);
    expect(s.missing_in_qb).toBe(1);
    expect(s.invalid).toBe(1);
    expect(s.errors).toBe(0);
  });

  it("SR3 — items with .error are counted under errors, not OK", () => {
    const s = summarizeReconciliation([
      { kind: DRIFT_KINDS.OK },
      { error: "fetch failed" },
      { error: "fetch failed" },
    ]);
    expect(s.errors).toBe(2);
    expect(s.ok).toBe(1);
    expect(s.total).toBe(3);
  });
});
