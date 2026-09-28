import { describe, it, expect } from "vitest";
import { isPennyTaxMismatch, buildTaxHoldState, pennyDriftAdoptPatch, PENNY_TAX_MAX } from "../qbTaxAutoAdopt.js";
import { reconcileQbInvoice } from "../qbWriteContracts.js";

const line = (amount) => ({ DetailType: "SalesItemLineDetail", Amount: amount });
const qb = (total, tax) => ({ TotalAmt: total, TxnTaxDetail: { TotalTax: tax }, Line: [line(total - tax)] });

describe("isPennyTaxMismatch", () => {
  it("Peter's Q-2026-Y009: 4¢ of AST rounding is penny tax (lines faithful, tax present)", () => {
    const r = reconcileQbInvoice({ sentLines: [line(242)], sentTax: 19.96, qbResponse: qb(262, 20) });
    expect(r.taxMismatch).toBe(true);
    expect(isPennyTaxMismatch(r)).toBe(true);
  });

  it("a dollar or more is a real hold (Reagan's Q-2026-JV81: $8.35 off)", () => {
    const r = reconcileQbInvoice({ sentLines: [line(562.6)], sentTax: 46.5, qbResponse: qb(617.45, 54.85) });
    expect(r.taxMismatch).toBe(true);
    expect(isPennyTaxMismatch(r)).toBe(false);
  });

  it("exactly $1.00 holds — the threshold is strictly below", () => {
    const r = reconcileQbInvoice({ sentLines: [line(100)], sentTax: 8, qbResponse: qb(109, 9) });
    expect(Math.abs(r.taxDrift)).toBe(1);
    expect(isPennyTaxMismatch(r)).toBe(false);
    expect(PENNY_TAX_MAX).toBe(1);
  });

  it("never auto-adopts the missing-tax case (quoted tax, QB recorded none)", () => {
    const r = reconcileQbInvoice({ sentLines: [line(10)], sentTax: 0.5, qbResponse: qb(10, 0) });
    expect(r.taxMismatch).toBe(true);
    expect(r.missingTax).toBe(true);
    expect(isPennyTaxMismatch(r)).toBe(false);
  });

  it("never auto-adopts line drift, a clean reconcile, or junk", () => {
    const drift = reconcileQbInvoice({ sentLines: [line(100)], sentTax: 0, qbResponse: qb(100.5, 0) });
    expect(drift.lineAmountDrift).toBe(true);
    expect(isPennyTaxMismatch(drift)).toBe(false);
    const ok = reconcileQbInvoice({ sentLines: [line(100)], sentTax: 8, qbResponse: qb(108, 8) });
    expect(isPennyTaxMismatch(ok)).toBe(false);
    expect(isPennyTaxMismatch(null)).toBe(false);
    expect(isPennyTaxMismatch({ taxMismatch: true, totalDrift: NaN, taxDrift: 0.01 })).toBe(false);
  });
});

describe("buildTaxHoldState", () => {
  it("snapshots the reconcile numbers the banner needs, cents-rounded", () => {
    const r = reconcileQbInvoice({ sentLines: [line(562.6)], sentTax: 46.5, qbResponse: qb(617.45, 54.85) });
    const hold = buildTaxHoldState(r, { now: new Date("2026-09-28T10:00:00Z") });
    expect(hold).toEqual({
      quoted_tax: 46.5, qb_tax: 54.85, tax_drift: 8.35,
      quoted_total: 609.1, qb_total: 617.45, missing_tax: false,
      held_at: "2026-09-28T10:00:00.000Z",
    });
  });
});

describe("pennyDriftAdoptPatch (nightly self-heal)", () => {
  it("adopts QB's total/tax/rate for sub-dollar drift and clears any hold", () => {
    const patch = pennyDriftAdoptPatch({ total: 261.97, drift: -0.03 }, qb(262, 20));
    expect(patch).toEqual({ total: 262, tax: 20, tax_rate: 8.2645, qb_tax_hold: null });
  });
  it("leaves dollar-plus drift alone — that is a conflict for the operator", () => {
    expect(pennyDriftAdoptPatch({ total: 507, drift: -41.9 }, qb(548.9, 41.9))).toBeNull();
    expect(pennyDriftAdoptPatch({ total: 100, drift: 1.0 }, qb(99, 0))).toBeNull();
  });
  it("refuses junk", () => {
    expect(pennyDriftAdoptPatch(null, qb(1, 0))).toBeNull();
    expect(pennyDriftAdoptPatch({ drift: 0.5 }, null)).toBeNull();
    expect(pennyDriftAdoptPatch({ drift: 0.5 }, { TotalAmt: "x" })).toBeNull();
  });
});
