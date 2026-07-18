import { describe, it, expect } from "vitest";
import {
  pickQbInvoiceForAdoption,
  mergeCustomerAuthoritative,
} from "../qbInvoice.js";

// Fixtures mirror the QB Invoice payload fields the picker reads.
const inv = (id, doc, { total = 100, balance = 100, created = "2026-07-17T01:00:00Z" } = {}) => ({
  Id: String(id),
  DocNumber: doc,
  TotalAmt: total,
  Balance: balance,
  MetaData: { CreateTime: created },
});

// ─────────────────────────────────────────────────────────────────────
// pickQbInvoiceForAdoption — the no-duplicate invariant's decision core
// ─────────────────────────────────────────────────────────────────────

describe("pickQbInvoiceForAdoption", () => {
  it("empty / missing family → nothing to adopt (caller CREATEs)", () => {
    expect(pickQbInvoiceForAdoption([])).toEqual({ paid: null, adopt: null, live: [] });
    expect(pickQbInvoiceForAdoption(null)).toEqual({ paid: null, adopt: null, live: [] });
  });

  it("fully-paid member → paid (caller must refuse to create)", () => {
    const paid = inv(3744, "INV-2026-OW0M1", { balance: 0 });
    const picked = pickQbInvoiceForAdoption([paid]);
    expect(picked.paid).toBe(paid);
    expect(picked.adopt).toBeNull();
  });

  it("single live unpaid member → adopt it (the Lisa Gotts case: the -r2 is never minted)", () => {
    const original = inv(3744, "INV-2026-OW0M1");
    const picked = pickQbInvoiceForAdoption([original]);
    expect(picked.adopt).toBe(original);
    expect(picked.paid).toBeNull();
  });

  it("member carrying a partial payment beats a newer unpaid one (protect applied money)", () => {
    const partialPaid = inv(1, "Q-1", { total: 100, balance: 40, created: "2026-07-01T00:00:00Z" });
    const newerUnpaid = inv(2, "Q-1-r2", { created: "2026-07-16T00:00:00Z" });
    const picked = pickQbInvoiceForAdoption([newerUnpaid, partialPaid]);
    expect(picked.adopt).toBe(partialPaid);
  });

  it("no payments anywhere → newest CreateTime wins", () => {
    const older = inv(1, "Q-1", { created: "2026-07-01T00:00:00Z" });
    const newer = inv(2, "Q-1-r2", { created: "2026-07-16T00:00:00Z" });
    expect(pickQbInvoiceForAdoption([older, newer]).adopt).toBe(newer);
  });

  it("voided members (TotalAmt 0) are invisible — all-voided family CREATEs fresh", () => {
    const voided = inv(1, "Q-1", { total: 0, balance: 0 });
    const picked = pickQbInvoiceForAdoption([voided]);
    expect(picked).toEqual({ paid: null, adopt: null, live: [] });
  });

  it("voided member doesn't shadow a live one", () => {
    const voided = inv(1, "Q-1", { total: 0, balance: 0, created: "2026-07-18T00:00:00Z" });
    const live = inv(2, "Q-1-r2", { created: "2026-07-01T00:00:00Z" });
    expect(pickQbInvoiceForAdoption([voided, live]).adopt).toBe(live);
  });

  it("live[] surfaces every non-voided member so callers can warn on pre-existing duplicates", () => {
    const a = inv(1, "Q-1");
    const b = inv(2, "Q-1-r2");
    const voided = inv(3, "Q-1-r3", { total: 0, balance: 0 });
    expect(pickQbInvoiceForAdoption([a, b, voided]).live).toEqual([a, b]);
  });

  it("paid wins even when unpaid members exist (books already settled)", () => {
    const paid = inv(1, "Q-1", { balance: 0 });
    const unpaid = inv(2, "Q-1-r2");
    const picked = pickQbInvoiceForAdoption([unpaid, paid]);
    expect(picked.paid).toBe(paid);
    expect(picked.adopt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// mergeCustomerAuthoritative — DB row wins over the caller's snapshot
// ─────────────────────────────────────────────────────────────────────

describe("mergeCustomerAuthoritative", () => {
  const dbRow = {
    id: "cust-1",
    name: "Lisa Gotts",
    company: "California 89",
    email: "Lisa@california89.com",
    phone: "",
    address: null,
    qb_customer_id: "52",
    tax_exempt: false,
    tax_id: null,
    ship_to_address: { state: "CA", zip: "96145" },
    exemption_expires_at: null,
    exemption_states: null,
    exemption_type: null,
    exemption_certificate_number: null,
  };

  it("minimal stub payload (the duplicate-customer door) → DB fills identity", () => {
    const merged = mergeCustomerAuthoritative(
      { id: "cust-1", name: "Lisa Gotts", email: "", company: "", qb_customer_id: "" },
      dbRow,
    );
    expect(merged.email).toBe("Lisa@california89.com");
    expect(merged.company).toBe("California 89");
    expect(merged.qb_customer_id).toBe("52");
  });

  it("DB non-empty values win over a stale snapshot's values", () => {
    const merged = mergeCustomerAuthoritative(
      { id: "cust-1", email: "old@stale.com", qb_customer_id: "260" },
      dbRow,
    );
    expect(merged.email).toBe("Lisa@california89.com");
    expect(merged.qb_customer_id).toBe("52");
  });

  it("payload keeps fields the DB row lacks (empty-string / null DB values)", () => {
    const merged = mergeCustomerAuthoritative(
      { id: "cust-1", phone: "555-0100", address: "1 Main St" },
      dbRow,
    );
    expect(merged.phone).toBe("555-0100");
    expect(merged.address).toBe("1 Main St");
  });

  it("boolean false in the DB is authoritative (not treated as empty)", () => {
    const merged = mergeCustomerAuthoritative({ id: "cust-1", tax_exempt: true }, dbRow);
    expect(merged.tax_exempt).toBe(false);
  });

  it("no DB row → payload passes through untouched", () => {
    const payload = { id: "cust-1", name: "Lisa Gotts" };
    expect(mergeCustomerAuthoritative(payload, null)).toBe(payload);
  });
});

// ─────────────────────────────────────────────────────────────────────
// pickNameOnlyCustomerMatch — the Lisa Gotts retrieval-gap fix
// ─────────────────────────────────────────────────────────────────────

import { pickNameOnlyCustomerMatch } from "../qbInvoice.js";

describe("pickNameOnlyCustomerMatch", () => {
  const california89 = {
    Id: "52",
    DisplayName: "California 89 (Lisa Gotts)",
    CompanyName: "California 89",
    GivenName: "Lisa Gotts",
  };

  it("matches the company-first QB customer from a sparse name-only record (the Lisa case)", () => {
    const hit = pickNameOnlyCustomerMatch([california89], { name: "Lisa Gotts", company: "" });
    expect(hit).toBe(california89);
  });

  it("never auto-matches when WE know a company (rung 3 already disagreed — contradiction)", () => {
    const hit = pickNameOnlyCustomerMatch([california89], { name: "Lisa Gotts", company: "Tahoe Gift Co." });
    expect(hit).toBeNull();
  });

  it("refuses ambiguity: two same-name candidates → null (human resolves)", () => {
    const other = { Id: "99", DisplayName: "Truckee Trading (Lisa Gotts)", CompanyName: "Truckee Trading", GivenName: "Lisa Gotts" };
    expect(pickNameOnlyCustomerMatch([california89, other], { name: "Lisa Gotts", company: "" })).toBeNull();
  });

  it("normalizes case/punctuation on the name comparison", () => {
    const hit = pickNameOnlyCustomerMatch([california89], { name: "lisa   gotts", company: "" });
    expect(hit).toBe(california89);
  });

  it("ignores candidates whose name doesn't actually equal ours", () => {
    const lisaSmith = { Id: "7", DisplayName: "Lisa Smith", GivenName: "Lisa Smith" };
    expect(pickNameOnlyCustomerMatch([lisaSmith], { name: "Lisa Gotts", company: "" })).toBeNull();
  });

  it("empty name or empty candidate list → null", () => {
    expect(pickNameOnlyCustomerMatch([], { name: "Lisa Gotts" })).toBeNull();
    expect(pickNameOnlyCustomerMatch([california89], { name: "" })).toBeNull();
    expect(pickNameOnlyCustomerMatch(null, { name: "Lisa Gotts" })).toBeNull();
  });
});
