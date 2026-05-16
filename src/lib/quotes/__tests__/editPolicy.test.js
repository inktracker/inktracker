import { describe, it, expect } from "vitest";
import {
  detectPostSendEditRisk,
  SACRED_STATUSES,
  POST_SEND_STATUSES,
  MONEY_AFFECTING_FIELDS,
} from "../editPolicy.js";

function quote(status, overrides = {}) {
  return {
    id: "q-1",
    status,
    line_items: [{ id: "li-1", style: "1717", sizes: { M: "50" } }],
    rush_rate: 0,
    extras: {},
    discount: 0,
    discount_type: "percent",
    tax_rate: 8.25,
    deposit_pct: 0,
    subtotal: 500,
    tax: 41.25,
    total: 541.25,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Draft — anything goes
// ─────────────────────────────────────────────────────────────────────

describe("detectPostSendEditRisk — Draft is unrestricted", () => {
  it("EP1 — Draft + money-field change → no risk reported", () => {
    const result = detectPostSendEditRisk(
      quote("Draft"),
      { total: 999 },
    );
    expect(result).toBe(null);
  });

  it("EP1 — undefined status treated as Draft", () => {
    expect(detectPostSendEditRisk(
      quote(undefined),
      { line_items: [{ id: "new" }] },
    )).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sent / Pending / Approved / Declined — WARN
// ─────────────────────────────────────────────────────────────────────

describe("detectPostSendEditRisk — Sent and friends warn (not block)", () => {
  it.each([["Sent"], ["Pending"], ["Approved"], ["Declined"]])(
    "EP2 — %s + money-field change → severity = 'warn'",
    (status) => {
      const result = detectPostSendEditRisk(
        quote(status),
        { total: 999, subtotal: 920 },
      );
      expect(result?.severity).toBe("warn");
      expect(result?.status).toBe(status);
    },
  );

  it("EP3 — warn message includes the status so the operator sees the context", () => {
    const result = detectPostSendEditRisk(
      quote("Sent"),
      { line_items: [{ id: "different" }] },
    );
    expect(result?.message).toMatch(/Sent/);
    expect(result?.message).toMatch(/customer/i);
  });

  it("EP4 — changedFields lists which money fields are being touched", () => {
    const result = detectPostSendEditRisk(
      quote("Sent"),
      { total: 999, discount: 50 },
    );
    expect(result?.changedFields).toContain("total");
    expect(result?.changedFields).toContain("discount");
    expect(result?.changedFields).not.toContain("subtotal"); // not in edit
  });
});

// ─────────────────────────────────────────────────────────────────────
// Approved and Paid / Converted to Order — BLOCK
// ─────────────────────────────────────────────────────────────────────

describe("detectPostSendEditRisk — Approved and Paid is sacred (block)", () => {
  it("EP5 — Approved and Paid + money-field change → severity = 'block'", () => {
    // The catastrophic case. Customer paid $500. Shop tries to edit
    // total to $600. InkTracker would silently show $600 even though
    // Stripe + QB show $500. Block.
    const result = detectPostSendEditRisk(
      quote("Approved and Paid", { total: 500 }),
      { total: 600 },
    );
    expect(result?.severity).toBe("block");
  });

  it("EP6 — 'Paid' legacy status is treated the same (block)", () => {
    // Older rows in the DB may have status='Paid' instead of the
    // current 'Approved and Paid'. They get the same protection.
    const result = detectPostSendEditRisk(
      quote("Paid"),
      { line_items: [{ id: "new" }] },
    );
    expect(result?.severity).toBe("block");
  });

  it("EP7 — block message suggests creating a new quote / revision", () => {
    const result = detectPostSendEditRisk(
      quote("Approved and Paid"),
      { discount: 50 },
    );
    expect(result?.message).toMatch(/revision|new quote/i);
  });

  it("EP8 — Converted to Order also blocks", () => {
    // The order is the new source of truth — editing the quote
    // breaks the audit chain.
    const result = detectPostSendEditRisk(
      quote("Converted to Order"),
      { total: 999 },
    );
    expect(result?.severity).toBe("block");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Non-money edits are always fine
// ─────────────────────────────────────────────────────────────────────

describe("detectPostSendEditRisk — non-money fields are always allowed", () => {
  it("EP9 — editing notes on a paid quote: no risk", () => {
    expect(detectPostSendEditRisk(
      quote("Approved and Paid"),
      { notes: "Updated shipping instructions" },
    )).toBe(null);
  });

  it("EP10 — editing due_date on a sent quote: no risk", () => {
    expect(detectPostSendEditRisk(
      quote("Sent"),
      { due_date: "2026-06-30" },
    )).toBe(null);
  });

  it("EP11 — editing customer_email on a paid quote: no risk (just notification routing)", () => {
    expect(detectPostSendEditRisk(
      quote("Approved and Paid"),
      { customer_email: "new@x.test" },
    )).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Field-equality semantics — must not false-positive
// ─────────────────────────────────────────────────────────────────────

describe("detectPostSendEditRisk — field-change detection", () => {
  it("EP12 — submitting unchanged values does NOT trigger a warning (re-save scenario)", () => {
    // Shop opens quote, hits Save without changing anything. The
    // edit payload includes the same values. We must NOT warn.
    const q = quote("Sent", { total: 541.25, subtotal: 500 });
    expect(detectPostSendEditRisk(
      q,
      { total: 541.25, subtotal: 500, line_items: q.line_items },
    )).toBe(null);
  });

  it("EP13 — line_items reordered with same content: counts as a change (defensive)", () => {
    // JSON-equality on line_items array: different order = different
    // payload. Safer to warn than to risk a "no-op" that actually
    // changed something nuanced (linked-print key flip, etc.).
    const a = [{ id: "li-1" }, { id: "li-2" }];
    const b = [{ id: "li-2" }, { id: "li-1" }];
    const result = detectPostSendEditRisk(
      quote("Sent", { line_items: a }),
      { line_items: b },
    );
    expect(result?.severity).toBe("warn");
  });

  it("EP14 — empty extras {} === empty extras {} (no false positive)", () => {
    expect(detectPostSendEditRisk(
      quote("Sent", { extras: {} }),
      { extras: {} },
    )).toBe(null);
  });

  it("EP15 — null vs undefined treated as equal (DB returns null, frontend may use undefined)", () => {
    expect(detectPostSendEditRisk(
      quote("Sent", { tax_rate: null }),
      { tax_rate: undefined },
    )).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defensive — null/undefined inputs
// ─────────────────────────────────────────────────────────────────────

describe("detectPostSendEditRisk — defensive cases", () => {
  it("EP16 — null currentQuote → null risk (no crash)", () => {
    expect(detectPostSendEditRisk(null, { total: 999 })).toBe(null);
  });

  it("EP17 — null edit → null risk", () => {
    expect(detectPostSendEditRisk(quote("Sent"), null)).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Constants are exported (tests + UI both want them)
// ─────────────────────────────────────────────────────────────────────

describe("Exported constants", () => {
  it("EP18 — SACRED_STATUSES includes the paid + converted cases", () => {
    expect(SACRED_STATUSES.has("Approved and Paid")).toBe(true);
    expect(SACRED_STATUSES.has("Converted to Order")).toBe(true);
    expect(SACRED_STATUSES.has("Paid")).toBe(true);
  });

  it("EP18 — POST_SEND_STATUSES is a superset of SACRED", () => {
    for (const s of SACRED_STATUSES) {
      expect(POST_SEND_STATUSES.has(s)).toBe(true);
    }
  });

  it("EP19 — MONEY_AFFECTING_FIELDS covers every total-impacting field", () => {
    // If a new pricing field is added (e.g. 'shipping'), it MUST be
    // added to MONEY_AFFECTING_FIELDS too or post-send edits skip
    // the guard for that field. This test documents the contract.
    expect(MONEY_AFFECTING_FIELDS).toContain("line_items");
    expect(MONEY_AFFECTING_FIELDS).toContain("total");
    expect(MONEY_AFFECTING_FIELDS).toContain("subtotal");
    expect(MONEY_AFFECTING_FIELDS).toContain("tax");
    expect(MONEY_AFFECTING_FIELDS).toContain("tax_rate");
    expect(MONEY_AFFECTING_FIELDS).toContain("discount");
    expect(MONEY_AFFECTING_FIELDS).toContain("discount_type");
    expect(MONEY_AFFECTING_FIELDS).toContain("rush_rate");
    expect(MONEY_AFFECTING_FIELDS).toContain("extras");
    expect(MONEY_AFFECTING_FIELDS).toContain("deposit_pct");
  });
});
