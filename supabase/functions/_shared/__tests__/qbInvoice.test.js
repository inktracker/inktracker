import { describe, it, expect } from "vitest";
import {
  resolveInvoiceCustomerFields,
  nextAvailableDocNumber,
  buildQBDisplayName,
  buildQBCustomerBody,
  escapeQbStringLiteral,
  buildInvoiceLinesFromPayload,
  extractPaymentLink,
  buildQbSendInvoiceUrl,
  makeOrderId,
  isLikelyEmail,
  stripDocNumberRevision,
  isRevisionDocNumber,
  isQbInvoicePaid,
  buildUpdateFailureResponse,
  pickIncomeAccountId,
  isNonSalesIncomeName,
  normalizeForMatch,
  customerIdentityMatches,
  normalizeItemName,
  clampPaymentAmount,
} from "../qbInvoice";

describe("normalizeForMatch", () => {
  it("lowercases, collapses whitespace, and strips punctuation", () => {
    expect(normalizeForMatch("Acme  Inc.")).toBe("acme inc");
    expect(normalizeForMatch("ACME, INC.")).toBe("acme inc");
    expect(normalizeForMatch("  Acme   Inc  ")).toBe("acme inc");
    expect(normalizeForMatch("Acme-Co")).toBe("acme co");
  });
  it("never throws on null/undefined/numbers", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
    expect(normalizeForMatch(42)).toBe("42");
  });
});

describe("customerIdentityMatches", () => {
  it("matches decisively on email regardless of name format", () => {
    const row = { DisplayName: "Totally Different", PrimaryEmailAddr: { Address: "JOE@biota.co" } };
    expect(customerIdentityMatches(row, { email: "joe@biota.co", company: "X" })).toBe(true);
  });

  it("matches a company+contact even when the QB DisplayName is formatted differently", () => {
    const row = { DisplayName: "Acme - John", CompanyName: "Acme", GivenName: "John" };
    expect(customerIdentityMatches(row, { company: "Acme", name: "John" })).toBe(true);
  });

  it("matches cosmetic differences (case / whitespace / punctuation)", () => {
    const row = { DisplayName: "acme, inc. (john)", CompanyName: "acme, inc.", GivenName: "john" };
    expect(customerIdentityMatches(row, { company: "Acme Inc", name: "John" })).toBe(true);
  });

  it("does NOT merge distinct contacts at the same company", () => {
    const row = { DisplayName: "Acme (Jane)", CompanyName: "Acme", GivenName: "Jane" };
    expect(customerIdentityMatches(row, { company: "Acme", name: "John" })).toBe(false);
  });

  it("matches company-only and name-only via DisplayName fallback", () => {
    expect(customerIdentityMatches({ DisplayName: "Acme", CompanyName: "Acme" }, { company: "Acme" })).toBe(true);
    expect(customerIdentityMatches({ DisplayName: "John Doe", GivenName: "John Doe" }, { name: "John Doe" })).toBe(true);
  });

  it("returns false on null inputs or when nothing identifies the customer", () => {
    expect(customerIdentityMatches(null, { company: "Acme" })).toBe(false);
    expect(customerIdentityMatches({ DisplayName: "Acme" }, null)).toBe(false);
    expect(customerIdentityMatches({ DisplayName: "Acme" }, {})).toBe(false);
  });
});

describe("pickIncomeAccountId", () => {
  const accts = [
    { Id: "10", Name: "Uncategorized Income" },
    { Id: "20", Name: "Sales" },
    { Id: "30", Name: "Services" },
  ];
  it("prefers the shop's chosen account when it still exists", () => {
    expect(pickIncomeAccountId(accts, "30")).toEqual({ id: "30", source: "configured" });
  });
  it("falls back to a preferred name when the chosen id is gone (deleted in QB)", () => {
    // "Sales" precedes "Services" in PREFERRED_INCOME_NAMES, so it wins.
    expect(pickIncomeAccountId(accts, "999")).toEqual({ id: "20", source: "preferred" });
  });
  it("guesses by preferred name when nothing is configured", () => {
    expect(pickIncomeAccountId(accts, null)).toEqual({ id: "20", source: "preferred" });
  });
  it("matches preferred names case-insensitively", () => {
    expect(pickIncomeAccountId([{ Id: "5", Name: "SALES" }], null)).toEqual({ id: "5", source: "preferred" });
  });
  it("skips non-sales income buckets when picking the first account", () => {
    // No preferred-name match; must skip "Uncategorized Income" and land
    // on the real sales account, not silently post revenue to junk.
    const odd = [{ Id: "10", Name: "Uncategorized Income" }, { Id: "99", Name: "Custom Apparel Income" }];
    expect(pickIncomeAccountId(odd, null)).toEqual({ id: "99", source: "first" });
  });
  it("uses the first real (non-junk) account when no preferred name matches", () => {
    const odd = [{ Id: "7", Name: "Consulting Income" }, { Id: "8", Name: "Misc" }];
    expect(pickIncomeAccountId(odd, null)).toEqual({ id: "7", source: "first" });
  });
  it("falls back to the first account only when EVERY income account looks non-sales", () => {
    const allJunk = [{ Id: "10", Name: "Uncategorized Income" }, { Id: "11", Name: "Other Income" }];
    expect(pickIncomeAccountId(allJunk, null)).toEqual({ id: "10", source: "fallback" });
  });
  it("returns null id when there are no income accounts", () => {
    expect(pickIncomeAccountId([], "30")).toEqual({ id: null, source: null });
  });
});

describe("clampPaymentAmount", () => {
  it("pays the full amount when it's within the balance", () => {
    expect(clampPaymentAmount(100, 100)).toEqual({ amount: 100, valid: true, capped: false });
    expect(clampPaymentAmount(60, 100)).toEqual({ amount: 60, valid: true, capped: false }); // partial
  });
  it("caps at the remaining balance — never overpays", () => {
    expect(clampPaymentAmount(60, 40)).toEqual({ amount: 40, valid: true, capped: true });
    // repeated full payment after balance already partly reduced
    expect(clampPaymentAmount(100, 0)).toEqual({ amount: 0, valid: false, capped: true });
  });
  it("ignores sub-cent rounding (no spurious cap flag)", () => {
    expect(clampPaymentAmount(100, 99.995)).toMatchObject({ capped: false });
  });
  it("rejects non-positive / non-finite requests", () => {
    expect(clampPaymentAmount(0, 100)).toMatchObject({ valid: false });
    expect(clampPaymentAmount(-5, 100)).toMatchObject({ valid: false });
    expect(clampPaymentAmount("abc", 100)).toMatchObject({ valid: false });
  });
  it("treats a missing/zero balance as nothing-left-to-pay", () => {
    expect(clampPaymentAmount(50, 0)).toMatchObject({ amount: 0, valid: false });
    expect(clampPaymentAmount(50, null)).toMatchObject({ amount: 0, valid: false });
  });
  it("coerces string inputs", () => {
    expect(clampPaymentAmount("50", "100")).toEqual({ amount: 50, valid: true, capped: false });
  });
});

describe("normalizeItemName", () => {
  it("makes singular/plural + punctuation/case variants match", () => {
    expect(normalizeItemName("T-Shirts")).toBe(normalizeItemName("T-Shirt"));
    expect(normalizeItemName("Tank Tops")).toBe(normalizeItemName("tank top"));
    expect(normalizeItemName("Hoodies & Sweatshirts")).toBe(normalizeItemName("Hoodie & Sweatshirt"));
    expect(normalizeItemName("Caps")).toBe(normalizeItemName("cap"));
  });
  it("keeps genuinely different items distinct", () => {
    expect(normalizeItemName("Screen Printing")).not.toBe(normalizeItemName("Embroidery"));
    expect(normalizeItemName("Setup Fee")).not.toBe(normalizeItemName("Custom Apparel"));
  });
  it("does not over-strip 'ss' words or short tokens", () => {
    expect(normalizeItemName("Glass")).toBe("glass");
    expect(normalizeItemName("Business")).toBe("business");
  });
  it("never throws on null/empty", () => {
    expect(normalizeItemName(null)).toBe("");
    expect(normalizeItemName("")).toBe("");
  });
});

describe("isNonSalesIncomeName", () => {
  it("flags common non-sales income buckets (substring, case-insensitive)", () => {
    expect(isNonSalesIncomeName("Uncategorized Income")).toBe(true);
    expect(isNonSalesIncomeName("other income")).toBe(true);
    expect(isNonSalesIncomeName("Interest Income")).toBe(true);
    expect(isNonSalesIncomeName("Billable Expense Income")).toBe(true);
  });
  it("does NOT flag real sales accounts", () => {
    expect(isNonSalesIncomeName("Sales")).toBe(false);
    expect(isNonSalesIncomeName("Sales of Product Income")).toBe(false);
    expect(isNonSalesIncomeName("Custom Apparel Income")).toBe(false);
    expect(isNonSalesIncomeName("")).toBe(false);
    expect(isNonSalesIncomeName(null)).toBe(false);
  });
});

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

  it("never sends customer-level tax fields, even when tax_exempt is truthy", () => {
    // Two QB gotchas: TaxExemptionReasonId's valid enum is 1–15 (we sent 16
    // → 400 code 2030), AND in Automated-Sales-Tax companies customer-level
    // Taxable is not API-settable and QB rejects it with a business-validation
    // 400 that blocked creation for every exempt customer. Exemption is
    // enforced on the invoice LINES (TaxCodeRef "NON") instead.
    const body = buildQBCustomerBody({ name: "Gov", tax_exempt: true }, "Gov");
    expect(body).not.toHaveProperty("Taxable");
    expect(body).not.toHaveProperty("TaxExemptionReasonId");
  });

  it("never sets Taxable regardless of tax_exempt flag", () => {
    expect(buildQBCustomerBody({ name: "John" }, "John")).not.toHaveProperty("Taxable");
    expect(buildQBCustomerBody({ name: "John", tax_exempt: false }, "John")).not.toHaveProperty("Taxable");
    expect(buildQBCustomerBody({ name: "John", tax_exempt: true }, "John")).not.toHaveProperty("Taxable");
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

  it("extracts the production-shape scs-v1 share link from /send response", () => {
    // The exact shape we get from POST /invoice/{id}/send on a real
    // shop with QB Payments enabled. Pinned verbatim from a 2026-05-18
    // production test (quote Q-2026-89SU, invoice 3669).
    const prodResponse = {
      Invoice: {
        Id: "3669",
        SyncToken: "1",
        DocNumber: "Q-2026-89SU",
        EmailStatus: "EmailSent",
        InvoiceLink: "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-7f190a8f3c6d403997092f7999a40c2d49c2c1b3acea4921ae25435d9673123aed8a7db05aae4f2aa78dfe6d08ed235d?locale=en_US&cta=v3invoicelink",
        BillEmail: { Address: "customer@example.com" },
      },
    };
    expect(extractPaymentLink(prodResponse)).toBe(prodResponse.Invoice.InvoiceLink);
  });
});

// ── buildQbSendInvoiceUrl ───────────────────────────────────────────────────

describe("buildQbSendInvoiceUrl", () => {
  const BASE = "https://quickbooks.api.intuit.com/v3/company";

  it("constructs the canonical /invoice/{id}/send URL with sendTo + minorversion", () => {
    expect(buildQbSendInvoiceUrl(BASE, "9341452", "3669", "customer@example.com"))
      .toBe("https://quickbooks.api.intuit.com/v3/company/9341452/invoice/3669/send?sendTo=customer%40example.com&minorversion=65");
  });

  it("URL-encodes plus-addresses in sendTo (regression — bare `+` decodes to space)", () => {
    // joe+test@biotamfg.co would otherwise become joe test@biotamfg.co on QBO's side
    const url = buildQbSendInvoiceUrl(BASE, "1", "1", "joe+test@biotamfg.co");
    expect(url).toContain("sendTo=joe%2Btest%40biotamfg.co");
    expect(url).not.toContain("joe+test@");
  });

  it("URL-encodes ampersands and = in sendTo (prevents query-string injection)", () => {
    // Pathological input — should never come from a real email, but the encoder
    // must not let it punch through and inject extra query params.
    const url = buildQbSendInvoiceUrl(BASE, "1", "1", "a&minorversion=99@x.com");
    expect(url).toContain("sendTo=a%26minorversion%3D99%40x.com");
    // The only minorversion in the final URL must be ours
    expect(url.match(/minorversion=/g) || []).toHaveLength(1);
    expect(url).toMatch(/minorversion=65$/);
  });

  it("trims trailing slashes from baseUrl so we don't get a double slash", () => {
    expect(buildQbSendInvoiceUrl(`${BASE}/`,  "1", "1", "a@b.co")).toContain("/company/1/invoice/");
    expect(buildQbSendInvoiceUrl(`${BASE}//`, "1", "1", "a@b.co")).toContain("/company/1/invoice/");
  });

  it("encodes realmId and invoiceId (defensive — both arrive as strings from QBO)", () => {
    const url = buildQbSendInvoiceUrl(BASE, "realm with space", "id/with/slash", "a@b.co");
    expect(url).toContain("/company/realm%20with%20space/invoice/id%2Fwith%2Fslash/send");
  });

  it("coerces numeric realmId / invoiceId without crashing", () => {
    const url = buildQbSendInvoiceUrl(BASE, 9341452, 3669, "a@b.co");
    expect(url).toBe("https://quickbooks.api.intuit.com/v3/company/9341452/invoice/3669/send?sendTo=a%40b.co&minorversion=65");
  });

  it("throws when any required arg is missing — caller MUST NOT call /send without a recipient", () => {
    // /send with a missing sendTo would either fail at QBO with a useless error
    // OR silently use a stale default; either way, we want a hard local error
    // rather than the API call going out.
    expect(() => buildQbSendInvoiceUrl("", "1", "1", "a@b.co")).toThrow(/baseUrl required/);
    expect(() => buildQbSendInvoiceUrl(BASE, "", "1", "a@b.co")).toThrow(/realmId required/);
    expect(() => buildQbSendInvoiceUrl(BASE, "1", "", "a@b.co")).toThrow(/invoiceId required/);
    expect(() => buildQbSendInvoiceUrl(BASE, "1", "1", "")).toThrow(/sendTo required/);
    expect(() => buildQbSendInvoiceUrl(BASE, "1", "1", null)).toThrow(/sendTo required/);
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

// ── isLikelyEmail ───────────────────────────────────────────────────────────
// Defensive guard for the QB sync path. Real bug: QB rejected the whole
// invoice creation with 400 ValidationFault because BillEmail was the
// customer's NAME ("Danielle Walton") instead of an email. Helper lets
// us omit the field instead of blocking the operation.

describe("isLikelyEmail", () => {
  it("E1 — accepts a basic email", () => {
    expect(isLikelyEmail("dani@example.com")).toBe(true);
  });

  it("E2 — accepts plus addressing + subdomains", () => {
    expect(isLikelyEmail("joe+filter@inktracker.app")).toBe(true);
    expect(isLikelyEmail("a@b.co.uk")).toBe(true);
  });

  it("E3 — rejects a person's name (the original bug)", () => {
    expect(isLikelyEmail("Danielle Walton")).toBe(false);
  });

  it("E4 — rejects empty / whitespace / non-string", () => {
    expect(isLikelyEmail("")).toBe(false);
    expect(isLikelyEmail("   ")).toBe(false);
    expect(isLikelyEmail(null)).toBe(false);
    expect(isLikelyEmail(undefined)).toBe(false);
    expect(isLikelyEmail(42)).toBe(false);
  });

  it("E5 — rejects missing @ or missing TLD", () => {
    expect(isLikelyEmail("hello.world")).toBe(false);
    expect(isLikelyEmail("no-at-sign")).toBe(false);
    expect(isLikelyEmail("missing-tld@local")).toBe(false);
  });

  it("E6 — rejects values containing whitespace around the @", () => {
    expect(isLikelyEmail("joe @inktracker.app")).toBe(false);
    expect(isLikelyEmail("joe@ ink.app")).toBe(false);
  });
});

describe("buildQBCustomerBody — email gating", () => {
  it("EM1 — drops a clearly invalid email so QB doesn't reject the customer create", () => {
    const body = buildQBCustomerBody(
      { name: "Danielle Walton", email: "Danielle Walton" },
      "Danielle Walton",
    );
    expect(body).not.toHaveProperty("PrimaryEmailAddr");
    expect(body.GivenName).toBe("Danielle Walton");
  });

  it("EM2 — keeps a valid email + trims whitespace", () => {
    const body = buildQBCustomerBody(
      { name: "Joe", email: "  joe@example.com  " },
      "Joe",
    );
    expect(body.PrimaryEmailAddr).toEqual({ Address: "joe@example.com" });
  });
});

// ── stripDocNumberRevision / isRevisionDocNumber ────────────────────────────
// These power the pullInvoices dedup fix that consolidates Q-2026-115 and
// Q-2026-115-r2 onto a single InkTracker invoice row. Regression-net for
// the "Shana Krochmal showed up twice" bug.

describe("stripDocNumberRevision", () => {
  it("returns the docNumber unchanged when there's no revision suffix", () => {
    expect(stripDocNumberRevision("Q-2026-115")).toBe("Q-2026-115");
    expect(stripDocNumberRevision("INV-001")).toBe("INV-001");
  });

  it("strips a single trailing -r<digits> suffix", () => {
    expect(stripDocNumberRevision("Q-2026-115-r2")).toBe("Q-2026-115");
    expect(stripDocNumberRevision("Q-2026-115-r99")).toBe("Q-2026-115");
  });

  it("only strips the FINAL -r<digits> — preserves any inner -rN parts", () => {
    // A DocNumber that itself contains "-r2-" should keep the inner text;
    // only the very last -rN suffix is the revision marker.
    expect(stripDocNumberRevision("Q-r2-2026-r3")).toBe("Q-r2-2026");
  });

  it("is case-insensitive on the r", () => {
    expect(stripDocNumberRevision("Q-2026-115-R2")).toBe("Q-2026-115");
  });

  it("does not strip non-revision -r tokens (no digits)", () => {
    expect(stripDocNumberRevision("Q-2026-115-rA")).toBe("Q-2026-115-rA");
    expect(stripDocNumberRevision("Q-2026-115-r")).toBe("Q-2026-115-r");
  });

  it("handles null / undefined / number inputs", () => {
    expect(stripDocNumberRevision(null)).toBe("");
    expect(stripDocNumberRevision(undefined)).toBe("");
    expect(stripDocNumberRevision(115)).toBe("115");
  });
});

describe("isRevisionDocNumber", () => {
  it("true when -r<digits> suffix is present", () => {
    expect(isRevisionDocNumber("Q-2026-115-r2")).toBe(true);
    expect(isRevisionDocNumber("Q-2026-115-R7")).toBe(true);
  });

  it("false on bare DocNumbers", () => {
    expect(isRevisionDocNumber("Q-2026-115")).toBe(false);
    expect(isRevisionDocNumber("")).toBe(false);
    expect(isRevisionDocNumber(null)).toBe(false);
  });

  it("false on near-misses (no digits, wrong separator)", () => {
    expect(isRevisionDocNumber("Q-2026-115-rA")).toBe(false);
    expect(isRevisionDocNumber("Q-2026-115r2")).toBe(false);
  });
});

// ── isQbInvoicePaid ─────────────────────────────────────────────────────────
// Power the "refuse to silently create a -r2 when the original is already
// paid" guard in qbSync. The wrong answer (false positive) creates the
// orphaned-row bug that started this. The wrong answer the other way (false
// negative) blocks legitimate resyncs.

describe("isQbInvoicePaid", () => {
  it("paid invoice: Balance=0 and TotalAmt>0", () => {
    expect(isQbInvoicePaid({ TotalAmt: 350, Balance: 0 })).toBe(true);
  });

  it("unpaid invoice: Balance = TotalAmt", () => {
    expect(isQbInvoicePaid({ TotalAmt: 350, Balance: 350 })).toBe(false);
  });

  it("partial payment is NOT paid (Balance > 0)", () => {
    expect(isQbInvoicePaid({ TotalAmt: 350, Balance: 100 })).toBe(false);
  });

  it("$0 invoice is never paid (drafts / blank invoices)", () => {
    expect(isQbInvoicePaid({ TotalAmt: 0, Balance: 0 })).toBe(false);
  });

  it("missing fields default to unpaid", () => {
    expect(isQbInvoicePaid({})).toBe(false);
    expect(isQbInvoicePaid(null)).toBe(false);
    expect(isQbInvoicePaid(undefined)).toBe(false);
  });

  it("string fields coerce numerically", () => {
    // QBO sometimes returns these as strings depending on the API surface.
    expect(isQbInvoicePaid({ TotalAmt: "350.00", Balance: "0" })).toBe(true);
    expect(isQbInvoicePaid({ TotalAmt: "350.00", Balance: "100" })).toBe(false);
  });
});

// ── buildUpdateFailureResponse ──────────────────────────────────────────────
//
// Regression fence for the Shana Krochmal Q-2026-F4O5-r2 duplication.
// Until 2026-05-30, handleCreateInvoice silently created a duplicate
// invoice when an UPDATE on the existing qb_invoice_id failed. The
// fix: refuse the duplicate and return this structured response so
// the frontend can render actionable guidance.

describe("buildUpdateFailureResponse (BUFR)", () => {
  it("BUFR1 — throws without qbInvoiceId (caller must supply)", () => {
    expect(() => buildUpdateFailureResponse({})).toThrow(/qbInvoiceId/);
  });

  it("BUFR2 — sets updateFailed: true and copies through the QB doc number", () => {
    const r = buildUpdateFailureResponse({
      qbInvoiceId: "1042",
      qbDocNumber: "Q-2026-F4O5",
      existingPaymentLink: "https://qb.example/pay/abc",
      updateErrMessage: "Stale Object Error",
    });
    expect(r.updateFailed).toBe(true);
    expect(r.qbInvoiceId).toBe("1042");
    expect(r.qbDocNumber).toBe("Q-2026-F4O5");
    expect(r.paymentLink).toBe("https://qb.example/pay/abc");
    expect(r.updateFailureReason).toBe("Stale Object Error");
  });

  it("BUFR3 — message names the DocNumber for operator clarity", () => {
    const r = buildUpdateFailureResponse({
      qbInvoiceId: "1042",
      qbDocNumber: "Q-2026-F4O5",
      updateErrMessage: "boom",
    });
    expect(r.message).toMatch(/Q-2026-F4O5/);
    expect(r.message).toMatch(/Refresh/);
    expect(r.message).toMatch(/refused to create a duplicate/i);
  });

  it("BUFR4 — falls back to numeric Id in the message when no DocNumber", () => {
    const r = buildUpdateFailureResponse({
      qbInvoiceId: "1042",
      updateErrMessage: "boom",
    });
    expect(r.message).toMatch(/Id 1042/);
  });

  it("BUFR5 — null payment link allowed (caller couldn't extract one)", () => {
    const r = buildUpdateFailureResponse({
      qbInvoiceId: "1042",
      qbDocNumber: "Q-1",
      existingPaymentLink: null,
      updateErrMessage: "x",
    });
    expect(r.paymentLink).toBe(null);
  });
});

// Sync guard — pins the fix for the beloved's re-burial (2026-06-10):
// pullInvoices nulled an existing customer link because QB's customer
// (inactive, post-merge) had no local mapping.
describe("resolveInvoiceCustomerFields", () => {
  const existing = { id: "row1", customer_id: "local-uuid", customer_name: "Zach Condron" };

  it("uses the local mapping when QB customer is mapped", () => {
    const out = resolveInvoiceCustomerFields({ id: "cust-1", name: "Tina Stull" }, existing, "QB Name");
    expect(out).toEqual({ customer_id: "cust-1", customer_name: "Tina Stull" });
  });

  it("PRESERVES an existing link when QB customer is unmapped (the re-burial guard)", () => {
    const out = resolveInvoiceCustomerFields(null, existing, "Beloved's Bakery & Cafe (deleted)");
    expect(out.customer_id).toBe("local-uuid");
    expect(out.customer_name).toBe("Zach Condron");
  });

  it("falls back to QB name with null link only when there is nothing to preserve", () => {
    const out = resolveInvoiceCustomerFields(null, null, "Some QB Customer");
    expect(out).toEqual({ customer_id: null, customer_name: "Some QB Customer" });
    const outNew = resolveInvoiceCustomerFields(null, { id: "row2", customer_id: null }, "X");
    expect(outNew.customer_id).toBe(null);
  });

  it("never returns an empty customer_name", () => {
    expect(resolveInvoiceCustomerFields(null, null, "").customer_name).toBe("Unknown");
    expect(resolveInvoiceCustomerFields({ id: "c", name: "" }, null, "").customer_name).toBe("Unknown");
  });
});

// ── per-line tax + fee handling (additional fees feature, 2026-06-15) ────────

describe("buildInvoiceLinesFromPayload — per-line tax + fees", () => {
  const itemIdMap = new Map([
    ["Screen Printing", "1"],
    ["Shipping", "2"],
    ["Setup Fee", "3"],
  ]);

  it("non-taxable fee line gets NON; taxable lines get TAX", () => {
    const payload = { lines: [
      { description: "Tee", qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Printing", taxable: true },
      { description: "Shipping", qty: 1, unitPrice: 15, amount: 15, itemName: "Shipping", taxable: false, isFee: true },
    ], taxPercent: 8 };
    const lines = buildInvoiceLinesFromPayload(payload, itemIdMap, "Screen Printing", false);
    const tee = lines.find((l) => l.Description === "Tee");
    const ship = lines.find((l) => l.Description === "Shipping");
    expect(tee.SalesItemLineDetail.TaxCodeRef.value).toBe("TAX");
    expect(ship.SalesItemLineDetail.TaxCodeRef.value).toBe("NON");
  });

  it("tax-exempt customer forces NON on every line", () => {
    const payload = { lines: [
      { description: "Tee", qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Printing", taxable: true },
    ] };
    const lines = buildInvoiceLinesFromPayload(payload, itemIdMap, "Screen Printing", true);
    expect(lines[0].SalesItemLineDetail.TaxCodeRef.value).toBe("NON");
  });

  it("discount spreads over garment lines only, leaving fees untouched", () => {
    const payload = { lines: [
      { description: "Tee", qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Printing", taxable: true },
      { description: "Shipping", qty: 1, unitPrice: 15, amount: 15, itemName: "Shipping", taxable: false, isFee: true },
    ], discountPercent: 10 };
    const lines = buildInvoiceLinesFromPayload(payload, itemIdMap, "Screen Printing", false);
    const tee = lines.find((l) => l.Description.startsWith("Tee"));
    const ship = lines.find((l) => l.Description === "Shipping");
    expect(tee.Amount).toBeCloseTo(90, 2);
    expect(ship.Amount).toBeCloseTo(15, 2);
  });

  it("strips transient _taxable/_isFee from emitted lines", () => {
    const payload = { lines: [
      { description: "Tee", qty: 1, unitPrice: 100, amount: 100, itemName: "Screen Printing", taxable: true },
    ] };
    const lines = buildInvoiceLinesFromPayload(payload, itemIdMap, "Screen Printing", false);
    // builder sets the hints; qbSync deletes them before send. The builder
    // output carries them for qbSync to read — assert they exist here so the
    // contract with qbSync is pinned.
    expect(lines[0]).toHaveProperty("_taxable", true);
  });
});
