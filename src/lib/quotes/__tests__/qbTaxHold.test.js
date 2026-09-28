import { describe, it, expect } from "vitest";
import { qbTaxHoldState } from "../qbTaxHold";

describe("qbTaxHoldState", () => {
  it("reads the persisted hold into camelCase the banner renders", () => {
    const row = { qb_tax_hold: { quoted_tax: 46.5, qb_tax: 54.85, tax_drift: 8.35, quoted_total: 609.1, qb_total: 617.45, missing_tax: false, held_at: "2026-09-28T10:00:00.000Z" } };
    expect(qbTaxHoldState(row)).toEqual({ quotedTax: 46.5, qbTax: 54.85, taxDrift: 8.35, quotedTotal: 609.1, qbTotal: 617.45, missingTax: false, heldAt: "2026-09-28T10:00:00.000Z" });
  });
  it("is null when there is no hold, the hold was cleared, or the payload is junk", () => {
    expect(qbTaxHoldState({})).toBeNull();
    expect(qbTaxHoldState({ qb_tax_hold: null })).toBeNull();
    expect(qbTaxHoldState({ qb_tax_hold: "yes" })).toBeNull();
    expect(qbTaxHoldState({ qb_tax_hold: { qb_total: "abc" } })).toBeNull();
    expect(qbTaxHoldState(null)).toBeNull();
  });
  it("tolerates numeric strings (jsonb round-trips) and missing optional fields", () => {
    const s = qbTaxHoldState({ qb_tax_hold: { qb_total: "100.50", qb_tax: "8.50" } });
    expect(s.qbTotal).toBe(100.5);
    expect(s.qbTax).toBe(8.5);
    expect(s.quotedTax).toBe(0);
    expect(s.missingTax).toBe(false);
    expect(s.heldAt).toBeNull();
  });
});
