import { describe, it, expect } from "vitest";
import { isQbInvoicePaid } from "../qbInvoice.js";
import { isInvoiceFullyPaid } from "../qbWebhookLogic.js";

// ONE "is this QB invoice fully paid?" predicate, applied at two surfaces
// (write path + webhook). They drifted: the webhook copy guarded against a
// missing Balance while the canonical read Number(null)→0 as PAID — so a
// sparse QB response flipped an OWED invoice to paid:true on the
// reconcile/refresh/link/pull paths and permanently suppressed its pay link
// (audit 2026-10-02). These pin the two in genuine lockstep on every edge.

const CASES = [
  // [invoice, expectedPaid, label]
  [null, false, "null invoice"],
  [undefined, false, "undefined invoice"],
  [{}, false, "empty object (no Balance → conservative not-paid)"],
  [{ TotalAmt: 100 }, false, "THE BUG: TotalAmt but NO Balance field — sparse response must NOT read as paid"],
  [{ TotalAmt: 100, Balance: null }, false, "explicit null Balance"],
  [{ TotalAmt: 100, Balance: undefined }, false, "explicit undefined Balance"],
  [{ TotalAmt: 100, Balance: "abc" }, false, "non-numeric Balance"],
  [{ TotalAmt: "abc", Balance: 0 }, false, "non-numeric TotalAmt"],
  [{ TotalAmt: 100, Balance: 0 }, true, "fully paid"],
  [{ TotalAmt: 100, Balance: "0" }, true, "fully paid, Postgres/QB string zero"],
  [{ TotalAmt: "100", Balance: 0 }, true, "fully paid, string total"],
  [{ TotalAmt: 100, Balance: 40 }, false, "partially paid"],
  [{ TotalAmt: 0, Balance: 0 }, false, "zero-total invoice is never 'paid' (empty/placeholder)"],
];

describe("isQbInvoicePaid (canonical) — null-Balance-safe", () => {
  for (const [inv, expected, label] of CASES) {
    it(`${label} → ${expected}`, () => {
      expect(isQbInvoicePaid(inv)).toBe(expected);
    });
  }
});

describe("LOCKSTEP: isQbInvoicePaid === isInvoiceFullyPaid on every edge", () => {
  it("the two predicates agree on all cases (same rule, two surfaces)", () => {
    for (const [inv, , label] of CASES) {
      expect(isQbInvoicePaid(inv), label).toBe(isInvoiceFullyPaid(inv));
    }
  });
});
