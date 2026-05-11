import { describe, it, expect } from "vitest";
import {
  nextAvailableDocNumber,
  buildQBDisplayName,
  buildQBCustomerBody,
  escapeQbStringLiteral,
  buildInvoiceLinesFromPayload,
  extractPaymentLink,
  makeOrderId,
} from "../qbInvoice";

// ── nextAvailableDocNumber ──────────────────────────────────────────────────

describe("nextAvailableDocNumber", () => {
  it("returns the base when nothing is taken", () => {
    expect(nextAvailableDocNumber("Q-2026-115", [])).toBe("Q-2026-115");
  });

  it("returns -r2 when only the base is taken", () => {
    expect(nextAvailableDocNumber("Q-2026-115", ["Q-2026-115"])).toBe("Q-2026-115-r2");
  });

  it("returns -r3 when base and -r2 are taken", () => {
    expect(nextAvailableDocNumber("Q-2026-115", ["Q-2026-115", "Q-2026-115-r2"]))
      .toBe("Q-2026-115-r3");
  });

  it("skips gaps in the revision sequence", () => {
    // base + r2 + r4 taken → next available is r3, not r5
    expect(nextAvailableDocNumber("Q", ["Q", "Q-r2", "Q-r4"])).toBe("Q-r3");
  });

  it("ignores noise from other DocNumbers", () => {
    expect(nextAvailableDocNumber("Q-2026-115", ["Q-2026-001", "Q-2026-115", "Q-2026-200"]))
      .toBe("Q-2026-115-r2");
  });

  it("handles non-array taken inputs by treating them as empty", () => {
    expect(nextAvailableDocNumber("Q", null)).toBe("Q");
    expect(nextAvailableDocNumber("Q", undefined)).toBe("Q");
  });

  it("filters out null/undefined entries in takenList", () => {
    expect(nextAvailableDocNumber("Q", ["Q", null, undefined, "Q-r2"])).toBe("Q-r3");
  });

  it("falls back to a timestamp-suffixed revision when r2..r99 are exhausted", () => {
    const taken = ["Q", ...Array.from({ length: 98 }, (_, i) => `Q-r${i + 2}`)];
    const result = nextAvailableDocNumber("Q", taken);
    expect(result).toMatch(/^Q-r[0-9a-z]{1,4}$/);
    expect(taken.includes(result)).toBe(false);
  });

  it("coerces a numeric base to string", () => {
    expect(nextAvailableDocNumber(115, [])).toBe("115");
  });
});

// ── buildQBDisplayName ──────────────────────────────────────────────────────

describe("buildQBDisplayName", () => {
  it("combines company + name when both present", () => {
    expect(buildQBDisplayName({ company: "Acme Mfg", name: "John Smith" }))
      .toBe("Acme Mfg (John Smith)");
  });

  it("returns just the company when no name", () => {
    expect(buildQBDisplayName({ company: "Acme Mfg" })).toBe("Acme Mfg");
  });

  it("returns just the name when no company", () => {
    expect(buildQBDisplayName({ name: "John Smith" })).toBe("John Smith");
  });

  it("trims whitespace before checking presence", () => {
    expect(buildQBDisplayName({ company: "   ", name: "John" })).toBe("John");
    expect(buildQBDisplayName({ company: "Acme", name: "   " })).toBe("Acme");
  });

  it("returns empty string when both are missing/blank", () => {
    expect(buildQBDisplayName({})).toBe("");
    expect(buildQBDisplayName({ company: "", name: "" })).toBe("");
    expect(buildQBDisplayName(null)).toBe("");
  });
});

// ── buildQBCustomerBody ─────────────────────────────────────────────────────

describe("buildQBCustomerBody", () => {
  it("emits a minimal body with only required + present fields", () => {
    const body = buildQBCustomerBody({ name: "John Smith" }, "John Smith");
    expect(body).toEqual({
      DisplayName: "John Smith",
      PrintOnCheckName: "John Smith",
      GivenName: "John Smith",
    });
    expect(body).not.toHaveProperty("CompanyName");
    expect(body).not.toHaveProperty("PrimaryEmailAddr");
  });

  it("includes every field that has a value", () => {
    const body = buildQBCustomerBody({
      company: "Acme",
      name: "John",
      notes: "VIP",
      email: "john@acme.com",
      phone: "555-0100",
      address: "1 Main St",
      tax_id: "TX-12345",
    }, "Acme (John)");
    expect(body).toEqual({
      DisplayName: "Acme (John)",
      PrintOnCheckName: "Acme",
      CompanyName: "Acme",
      GivenName: "John",
      Notes: "VIP",
      PrimaryEmailAddr: { Address: "john@acme.com" },
      PrimaryPhone: { FreeFormNumber: "555-0100" },
      BillAddr: { Line1: "1 Main St" },
      ResaleNum: "TX-12345",
    });
  });

  it("PrintOnCheckName prefers company > name > displayName", () => {
    expect(buildQBCustomerBody({ company: "Acme", name: "John" }, "X").PrintOnCheckName).toBe("Acme");
    expect(buildQBCustomerBody({ name: "John" },                  "X").PrintOnCheckName).toBe("John");
    expect(buildQBCustomerBody({},                                "Fallback").PrintOnCheckName).toBe("Fallback");
  });

  it("sets Taxable=false + reason 16 when tax_exempt is truthy", () => {
    const body = buildQBCustomerBody({ name: "Gov", tax_exempt: true }, "Gov");
    expect(body.Taxable).toBe(false);
    expect(body.TaxExemptionReasonId).toBe(16);
  });

  it("does NOT set Taxable when tax_exempt is false/missing", () => {
    expect(buildQBCustomerBody({ name: "John" }, "John")).not.toHaveProperty("Taxable");
    expect(buildQBCustomerBody({ name: "John", tax_exempt: false }, "John")).not.toHaveProperty("Taxable");
  });

  it("survives null/undefined customer without throwing", () => {
    const body = buildQBCustomerBody(null, "Fallback");
    expect(body.DisplayName).toBe("Fallback");
    expect(body.PrintOnCheckName).toBe("Fallback");
  });

  it("does NOT emit empty-string fields (QB rejects null/empty on some keys)", () => {
    const body = buildQBCustomerBody(
      { name: "John", company: "", email: "", phone: "", address: "" },
      "John"
    );
    expect(body).not.toHaveProperty("CompanyName");
    expect(body).not.toHaveProperty("PrimaryEmailAddr");
    expect(body).not.toHaveProperty("PrimaryPhone");
    expect(body).not.toHaveProperty("BillAddr");
  });
});

// ── escapeQbStringLiteral ───────────────────────────────────────────────────

describe("escapeQbStringLiteral", () => {
  it("doubles single quotes per QB BNF", () => {
    expect(escapeQbStringLiteral("O'Brien")).toBe("O''Brien");
    expect(escapeQbStringLiteral("It's a 'test'")).toBe("It''s a ''test''");
  });

  it("does NOT use backslash escaping (QB silently breaks on \\)", () => {
    expect(escapeQbStringLiteral("foo'bar")).not.toContain("\\");
  });

  it("returns empty string for null/undefined", () => {
    expect(escapeQbStringLiteral(null)).toBe("");
    expect(escapeQbStringLiteral(undefined)).toBe("");
  });

  it("coerces non-strings to string", () => {
    expect(escapeQbStringLiteral(42)).toBe("42");
  });

  it("leaves a value with no quotes unchanged", () => {
    expect(escapeQbStringLiteral("hello world")).toBe("hello world");
  });
});

// ── buildInvoiceLinesFromPayload ────────────────────────────────────────────

describe("buildInvoiceLinesFromPayload", () => {
  const itemMap = new Map([
    ["Screen Print", "10"],
    ["Embroidery",   "11"],
  ]);

  it("translates each line into a SalesItemLineDetail with the right item id", () => {
    const lines = buildInvoiceLinesFromPayload({
      lines: [
        { qty: 10, unitPrice: 12, amount: 120, itemName: "Screen Print", description: "Tee" },
      ],
    }, itemMap, "Screen Print", false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      DetailType: "SalesItemLineDetail",
      Amount: 120,
      Description: "Tee",
      SalesItemLineDetail: {
        ItemRef: { value: "10" },
        UnitPrice: 12,
        Qty: 10,
        TaxCodeRef: { value: "TAX" },
      },
    });
  });

  it("falls back to defaultItem when itemName isn't in the map", () => {
    const lines = buildInvoiceLinesFromPayload({
      lines: [{ qty: 5, unitPrice: 10, amount: 50, itemName: "Unknown Service" }],
    }, itemMap, "Screen Print");
    expect(lines[0].SalesItemLineDetail.ItemRef.value).toBe("10");
  });

  it("skips lines where the default item also isn't in the map (no item id at all)", () => {
    const lines = buildInvoiceLinesFromPayload(
      { lines: [{ qty: 5, unitPrice: 10, amount: 50, itemName: "X" }] },
      new Map(), "Y"
    );
    expect(lines).toEqual([]);
  });

  it("skips zero-qty and zero-amount lines", () => {
    const lines = buildInvoiceLinesFromPayload({
      lines: [
        { qty: 0, unitPrice: 10, amount: 0,   itemName: "Screen Print" },
        { qty: 5, unitPrice: 0,  amount: 0,   itemName: "Screen Print" },
        { qty: 5, unitPrice: 10, amount: 50,  itemName: "Screen Print" },
      ],
    }, itemMap, "Screen Print");
    expect(lines).toHaveLength(1);
    expect(lines[0].Amount).toBe(50);
  });

  it("uses TaxCodeRef='NON' when invoice is tax-exempt", () => {
    const lines = buildInvoiceLinesFromPayload(
      { lines: [{ qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Print" }] },
      itemMap, "Screen Print", true
    );
    expect(lines[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: "NON" });
  });

  it("returns empty array when payload has no lines", () => {
    expect(buildInvoiceLinesFromPayload({}, itemMap, "Screen Print")).toEqual([]);
    expect(buildInvoiceLinesFromPayload({ lines: [] }, itemMap, "Screen Print")).toEqual([]);
    expect(buildInvoiceLinesFromPayload(null, itemMap, "Screen Print")).toEqual([]);
  });

  it("survives a non-Map itemIdMap by treating it as empty", () => {
    expect(buildInvoiceLinesFromPayload(
      { lines: [{ qty: 1, unitPrice: 1, amount: 1 }] },
      "not-a-map", "Screen Print"
    )).toEqual([]);
  });

  it("rounds Amount to 2 decimals", () => {
    const lines = buildInvoiceLinesFromPayload(
      { lines: [{ qty: 3, unitPrice: 0.333, amount: 0.999, itemName: "Screen Print" }] },
      itemMap, "Screen Print"
    );
    expect(lines[0].Amount).toBe(1);
  });

  describe("discount handling", () => {
    it("distributes a flat discount proportionally across line amounts", () => {
      const lines = buildInvoiceLinesFromPayload({
        lines: [
          { qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Print" },
          { qty: 1, unitPrice: 200, amount: 200, itemName: "Screen Print" },
        ],
        discountAmount: 30,
        discountType: "flat",
      }, itemMap, "Screen Print");
      // $30 off $300 total = 10% per line: line1 -10, line2 -20
      expect(lines[0].Amount).toBe(90);
      expect(lines[1].Amount).toBe(180);
      // total still sums to original - discount
      expect(lines[0].Amount + lines[1].Amount).toBe(270);
    });

    it("distributes a percent discount across line amounts", () => {
      const lines = buildInvoiceLinesFromPayload({
        lines: [
          { qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Print" },
          { qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Print" },
        ],
        discountPercent: 10,
      }, itemMap, "Screen Print");
      expect(lines[0].Amount + lines[1].Amount).toBe(180);
    });

    it("annotates each discounted line with a label", () => {
      const lines = buildInvoiceLinesFromPayload({
        lines: [{ qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Print", description: "Tee" }],
        discountPercent: 15,
      }, itemMap, "Screen Print");
      expect(lines[0].Description).toBe("Tee (less 15% discount)");
    });

    it("uses the dollar-amount label for flat discounts", () => {
      const lines = buildInvoiceLinesFromPayload({
        lines: [{ qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Print" }],
        discountAmount: 25,
        discountType: "flat",
      }, itemMap, "Screen Print");
      expect(lines[0].Description).toContain("less $25.00 discount");
    });

    it("recomputes UnitPrice after the discount is applied", () => {
      const lines = buildInvoiceLinesFromPayload({
        lines: [{ qty: 10, unitPrice: 10, amount: 100, itemName: "Screen Print" }],
        discountPercent: 10,
      }, itemMap, "Screen Print");
      // $100 - 10% = $90, qty 10 → unit price $9
      expect(lines[0].SalesItemLineDetail.UnitPrice).toBe(9);
    });

    it("the last line absorbs rounding remainder so amounts sum exactly", () => {
      // $100 with 33.33% gives $33.33 total → distributed across 3 lines may
      // produce rounding drift if naive. Last line gets the remainder.
      const lines = buildInvoiceLinesFromPayload({
        lines: [
          { qty: 1, unitPrice: 33.33, amount: 33.33, itemName: "Screen Print" },
          { qty: 1, unitPrice: 33.33, amount: 33.33, itemName: "Screen Print" },
          { qty: 1, unitPrice: 33.34, amount: 33.34, itemName: "Screen Print" },
        ],
        discountAmount: 10,
        discountType: "flat",
      }, itemMap, "Screen Print");
      const total = lines.reduce((s, l) => s + l.Amount, 0);
      expect(Number(total.toFixed(2))).toBe(90); // $100 - $10 = $90
    });

    it("doesn't choke when the invoice has only zero-amount lines + a discount", () => {
      const lines = buildInvoiceLinesFromPayload({
        lines: [{ qty: 0, unitPrice: 10, amount: 0, itemName: "Screen Print" }],
        discountAmount: 5,
        discountType: "flat",
      }, itemMap, "Screen Print");
      expect(lines).toEqual([]);
    });
  });
});

// ── extractPaymentLink ──────────────────────────────────────────────────────

describe("extractPaymentLink", () => {
  it("prefers payment.paymentUri when present", () => {
    expect(extractPaymentLink({
      Invoice: { payment: { paymentUri: "https://payments.intuit.com/abc" } },
    })).toBe("https://payments.intuit.com/abc");
  });

  it("falls back to InvoiceLink, then paymentUri, then Links[].Href", () => {
    expect(extractPaymentLink({ Invoice: { InvoiceLink: "https://a" } })).toBe("https://a");
    expect(extractPaymentLink({ Invoice: { paymentUri:  "https://b" } })).toBe("https://b");
    expect(extractPaymentLink({ Invoice: { Links: [
      { Rel: "self",    Href: "https://x" },
      { Rel: "payment", Href: "https://c" },
    ] } })).toBe("https://c");
  });

  it("accepts an unwrapped invoice object too (some QB calls return Invoice directly)", () => {
    expect(extractPaymentLink({ payment: { paymentUri: "https://z" } })).toBe("https://z");
  });

  it("returns null when no candidate is present (QB Payments not enabled)", () => {
    expect(extractPaymentLink({ Invoice: { Id: "42" } })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(extractPaymentLink(null)).toBeNull();
    expect(extractPaymentLink(undefined)).toBeNull();
  });

  it("does NOT fabricate a connect.intuit.com fallback URL", () => {
    // This is the regression we shipped a fix for in PR #6 — the old code
    // returned a login-required `connect.intuit.com/portal/asei/...` URL
    // when no real payment link was available, which broke the Approve&Pay
    // button. The contract here is: no real link → null.
    const result = extractPaymentLink({ Invoice: { Id: "42" } });
    expect(result).toBeNull();
    expect(result === null || !String(result).includes("connect.intuit.com")).toBe(true);
  });
});

// ── makeOrderId ─────────────────────────────────────────────────────────────

describe("makeOrderId", () => {
  it("produces ORD-{year}-{base36-suffix} format", () => {
    const id = makeOrderId(new Date("2026-05-11T00:00:00Z").getTime());
    expect(id).toMatch(/^ORD-2026-[0-9A-Z]{1,5}$/);
  });

  it("uses the provided `now` deterministically", () => {
    const t = new Date("2026-05-11T12:00:00Z").getTime();
    expect(makeOrderId(t)).toBe(makeOrderId(t));
  });

  it("yields different IDs for different timestamps (no accidental collision)", () => {
    const a = makeOrderId(1000000);
    const b = makeOrderId(1000001);
    expect(a).not.toBe(b);
  });

  it("uses the current year when `now` is in that year", () => {
    // Mid-year dates avoid timezone-boundary flakiness (the function uses
    // local-time getFullYear, so a UTC instant near midnight Jan 1 lands
    // in the previous year when run in a negative-UTC zone).
    expect(makeOrderId(new Date("2025-06-15T12:00:00Z").getTime())).toMatch(/^ORD-2025-/);
    expect(makeOrderId(new Date("2030-06-15T12:00:00Z").getTime())).toMatch(/^ORD-2030-/);
  });

  it("suffix is uppercase base36 of the timestamp's last 5 chars", () => {
    const id = makeOrderId(123456789);
    expect(id).toMatch(/^ORD-\d{4}-[0-9A-Z]{1,5}$/);
  });
});
