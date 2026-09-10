import { describe, it, expect } from "vitest";
import {
  isSensitiveField, redactRow, toCsv, formatCell, escapeCsvCell, humanizeLabel, HIDE_FIELDS,
} from "../exportFormat";

describe("isSensitiveField — bearer credentials", () => {
  it("flags tokens, secrets, and payment links", () => {
    for (const k of [
      "public_token", "qb_payment_link", "qb_deposit_payment_link", "payment_link",
      "access_token", "refresh_token", "qb_sync_token", "auth_secret", "client_secret",
    ]) {
      expect(isSensitiveField(k)).toBe(true);
    }
  });
  it("leaves ordinary business columns alone", () => {
    for (const k of ["total", "customer_name", "tax_id", "balance", "created_date", "link_type"]) {
      expect(isSensitiveField(k)).toBe(false);
    }
  });
});

describe("redactRow", () => {
  it("strips sensitive keys, keeps the rest", () => {
    const row = { id: "1", total: 50, public_token: "abc", qb_payment_link: "https://pay/x", customer_name: "Bob" };
    expect(redactRow(row)).toEqual({ id: "1", total: 50, customer_name: "Bob" });
  });
  it("is a no-op on non-objects", () => {
    expect(redactRow(null)).toBe(null);
    expect(redactRow("x")).toBe("x");
  });
});

describe("escapeCsvCell — formula injection guard", () => {
  it("neutralizes cells starting with a formula trigger", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+49 555")).toBe("'+49 555"); // prefixed, no comma → not RFC-quoted
  });
  it("prefixes a quote for = + - @ and tab/CR leads", () => {
    expect(escapeCsvCell("=cmd|' /C calc'!A1")).toMatch(/^"?'=/);
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
  });
  it("does not touch ordinary text or numbers", () => {
    expect(escapeCsvCell("Bob Smith")).toBe("Bob Smith");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(null)).toBe("");
  });
  it("still RFC-4180 quotes commas, quotes, newlines", () => {
    expect(escapeCsvCell("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe("formatCell — line-item summary", () => {
  it("summarizes real InkTracker line items (product_title + sizes map)", () => {
    const items = [
      { product_title: "Next Level 3600", color: "Black", sizes: { S: 6, M: 12, L: 6 } },
      { garmentName: "AS Colour 5050", sizes: { M: 12 } },
    ];
    expect(formatCell("line_items", items)).toBe("Next Level 3600 (Black) × 24; AS Colour 5050 × 12");
  });
  it("never dumps raw JSON (no internal cost leak) when it can't name the item", () => {
    const out = formatCell("line_items", [{ garmentCost: 3.5, partner_source: "front-st" }]);
    expect(out).toBe("");
    expect(out).not.toContain("garmentCost");
  });
  it("honors an explicit quantity field", () => {
    expect(formatCell("x", [{ name: "Tee", quantity: 5 }])).toBe("Tee × 5");
  });
  it("formats booleans and dates", () => {
    expect(formatCell("is_tax_exempt", true)).toBe("Yes");
    expect(formatCell("created_date", "2026-09-09T14:30:00Z")).toMatch(/2026/);
  });
});

describe("toCsv", () => {
  it("excludes sensitive AND hidden columns from headers", () => {
    const rows = [{ id: "1", total: 10, public_token: "t", shop_owner: "me@x.com", customer_name: "Bob" }];
    const csv = toCsv(rows);
    const header = csv.split("\n")[0];
    expect(header).not.toContain("Token");
    expect(header).not.toContain("Shop Owner");
    expect(header).toContain("Total");
    expect(header).toContain("Customer");
  });
  it("escapes a formula-injection customer name in the body", () => {
    const rows = [{ customer_name: "=HYPERLINK(evil)", total: 1 }];
    const csv = toCsv(rows);
    expect(csv).toContain("'=HYPERLINK(evil)");
  });
  it("returns empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("humanizeLabel", () => {
  it("uses overrides then Title Case", () => {
    expect(humanizeLabel("qb_invoice_id")).toBe("QB Invoice ID");
    expect(humanizeLabel("some_custom_field")).toBe("Some Custom Field");
  });
  it("HIDE_FIELDS is populated", () => {
    expect(HIDE_FIELDS.has("shop_owner")).toBe(true);
  });
});
