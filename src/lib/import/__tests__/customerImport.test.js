import { describe, it, expect } from "vitest";
import {
  normalizeForMatch, customerRowMatches, parseCsv, mapCustomerRow, classifyImport,
  isLikelyEmail,
} from "../customerImport";
// The QB sync's matcher is pure JS (no Deno-only imports), so we import the
// REAL functions and compare — not a substring check of its source.
import {
  normalizeForMatch as qbNormalizeForMatch,
  isLikelyEmail as qbIsLikelyEmail,
  customerIdentityMatches,
} from "../../../../supabase/functions/_shared/qbInvoice.js";

describe("normalizeForMatch — REAL drift canary vs QB sync", () => {
  // The importer's matcher must stay identical to the QB one, or the two would
  // disagree on "same customer" and let QB dups slip in. This executes BOTH
  // functions over a wide battery and asserts equal output character-for-char.
  it("produces identical output to qbInvoice.normalizeForMatch across a battery", () => {
    const battery = [
      "Acme, Inc.", "acme inc", "  John  Doe ", "O'Brien-Smith", "TÊST", "",
      null, undefined, 12345, "  ", "\tTab\tsep\t", "line\nbreak",
      ".,/#!$%^&*;:{}=-_`~()", "Über Café", "MiXeD    CaSe",
      "Company (Contact Name)", "a.b.c", "x---y", "  leading", "trailing  ",
      "Ünïcödé Wörks", "emoji 🎨 art", "多 byte 字", "quote\"inside",
    ];
    for (const v of battery) {
      expect(normalizeForMatch(v)).toBe(qbNormalizeForMatch(v));
    }
  });

  it("isLikelyEmail also stays identical to the QB one (both dedup on it)", () => {
    const emails = [
      "a@b.com", "A@B.COM", "  x@y.co ", "n/a", "none", "", "  ",
      "a@b@c.com", "no-at-sign", "a@b", "a@b.", "@b.com", "a@.com",
      "first.last@sub.domain.io", "x@y.z", 12345, null, undefined,
    ];
    for (const v of emails) {
      expect(isLikelyEmail(v)).toBe(qbIsLikelyEmail(v));
    }
  });

  it("still normalizes the canonical cases", () => {
    expect(normalizeForMatch("Acme, Inc.")).toBe("acme inc");
    expect(normalizeForMatch("  John  Doe ")).toBe("john doe");
  });
});

describe("customerRowMatches — QB-safe dedup ladder", () => {
  it("email is decisive (case-insensitive)", () => {
    expect(customerRowMatches({ email: "A@B.com", name: "X" }, { email: "a@b.com", name: "Y" })).toBe(true);
  });
  it("differing emails still match on identity (same name = updated email, a merge not a dup)", () => {
    expect(customerRowMatches({ email: "a@b.com", name: "Joe" }, { email: "c@d.com", name: "Joe" })).toBe(true);
  });
  it("differing emails + same name but DIFFERENT company do not match", () => {
    expect(customerRowMatches({ email: "a@b.com", name: "Joe", company: "Acme" }, { email: "c@d.com", name: "Joe", company: "Beta" })).toBe(false);
  });
  it("company + name both required when both present", () => {
    const row = { company: "Acme", name: "John Doe" };
    expect(customerRowMatches(row, { company: "acme", name: "john doe" })).toBe(true);
    expect(customerRowMatches(row, { company: "acme", name: "jane roe" })).toBe(false);
  });
  it("single field matches when only one is present", () => {
    expect(customerRowMatches({ company: "Acme" }, { company: "ACME" })).toBe(true);
    expect(customerRowMatches({ name: "Bob" }, { name: "bob" })).toBe(true);
  });

  // GAP-A: the asymmetric-enrichment bug. A QB record with only a name (blank
  // company) must still match a RICHER incoming row that adds a company —
  // otherwise the QB customer gets duplicated. Match is symmetric over the
  // fields both sides actually have.
  it("matches a name-only existing (QB) record against a name+company row (no dup)", () => {
    const richRow = { name: "John Doe", company: "Acme" };
    const sparseQb = { name: "john doe", company: "", id: "qb1" };
    expect(customerRowMatches(richRow, sparseQb)).toBe(true);
  });
  it("matches a company-only existing record against a name+company row", () => {
    expect(customerRowMatches({ name: "John Doe", company: "Acme" }, { name: "", company: "acme" })).toBe(true);
  });
  it("no shared field → no match", () => {
    expect(customerRowMatches({ name: "John" }, { company: "Acme" })).toBe(false);
  });
});

describe("customerRowMatches agrees with QB customerIdentityMatches (adoption safety)", () => {
  // The importer's whole guarantee is that a customer it inserts (no qb_id)
  // will later be ADOPTED by pullCustomers, not duplicated. So the two matchers
  // must agree on the same logical customer, INCLUDING when one side is richer
  // than the other. Each case gives the QB row, its InkTracker shape, and an
  // INCOMING CSV row (deliberately NOT identical to the IT shape) so the import
  // direction is a real test, not a compare-to-self.
  const cases = [
    { qb: { GivenName: "John", FamilyName: "Doe", CompanyName: "Acme" }, it: { name: "John Doe", company: "Acme" }, csv: { name: "John Doe", company: "Acme" } },
    { qb: { GivenName: "Sara", FamilyName: "", CompanyName: "" }, it: { name: "Sara", company: "" }, csv: { name: "Sara", company: "" } },
    { qb: { GivenName: "Meg", FamilyName: "Ryan", CompanyName: "" }, it: { name: "Meg Ryan", company: "" }, csv: { name: "Meg Ryan", company: "" } },
  ];
  for (const { qb, it: itc, csv } of cases) {
    it(`both see "${itc.name}" / "${itc.company}" as the same customer`, () => {
      expect(customerIdentityMatches(qb, itc)).toBe(true);
      expect(customerRowMatches(csv, itc)).toBe(true);
    });
  }

  // Audit F1 regression: an InkTracker record ENRICHED with a company must
  // still be adopted by a company-less (individual) QB customer of the same
  // name — otherwise the next pullCustomers duplicates it. This is the exact
  // asymmetry wave 1 left on the customerIdentityMatches side.
  it("adopts a company-enriched IT customer into a company-less QB row (no dup)", () => {
    const qbIndividual = { GivenName: "John", FamilyName: "Doe", CompanyName: "", DisplayName: "John Doe" };
    const itEnriched = { name: "John Doe", company: "Acme Screenprint" };
    expect(customerIdentityMatches(qbIndividual, itEnriched)).toBe(true);
  });

  it("does NOT over-match a different name just because the QB row lacks a company", () => {
    const qbIndividual = { GivenName: "Jane", FamilyName: "Roe", CompanyName: "", DisplayName: "Jane Roe" };
    const itEnriched = { name: "John Doe", company: "Acme" };
    expect(customerIdentityMatches(qbIndividual, itEnriched)).toBe(false);
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas, CRLF, and BOM", () => {
    const csv = '﻿Name,Company,Email\r\n"Doe, John","Acme, Inc.",j@a.com\r\nBob,,b@x.com\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["Name", "Company", "Email"]);
    expect(rows[0]).toEqual({ Name: "Doe, John", Company: "Acme, Inc.", Email: "j@a.com" });
    expect(rows[1].Name).toBe("Bob");
  });

  it("treats a stray quote mid-field as a literal (inch marks, Apt \"B\") — does NOT swallow later fields", () => {
    const csv = 'Name,Note,Email\nBob,12" sleeve run,b@x.com\nAmy,Apt "B" downtown,a@x.com\n';
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "Bob", Note: '12" sleeve run', Email: "b@x.com" });
    expect(rows[1]).toEqual({ Name: "Amy", Note: 'Apt "B" downtown', Email: "a@x.com" });
  });

  it("still honors a properly-quoted field that itself contains escaped quotes", () => {
    const csv = 'Name,Note\n"Big ""Al""","says ""hi"""\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toEqual({ Name: 'Big "Al"', Note: 'says "hi"' });
  });
});

describe("mapCustomerRow — header aliases", () => {
  it("builds name from first/last and reads common aliases", () => {
    expect(mapCustomerRow({ "First Name": "John", "Last Name": "Doe", "Company Name": "Acme", "Email Address": "j@a.com" }))
      .toEqual({ name: "John Doe", company: "Acme", email: "j@a.com", phone: null, address: null });
  });
  it("prefers an explicit full name column", () => {
    expect(mapCustomerRow({ Name: "Jane Roe", Phone: "555" }).name).toBe("Jane Roe");
  });
  it("reads Printavo 'Primary Contact' and 'Billing Address 1'", () => {
    const c = mapCustomerRow({ "Primary Contact": "Dana Lin", "Billing Address 1": "5 Ink St", "Company": "Press Co" });
    expect(c.name).toBe("Dana Lin");
    expect(c.address).toBe("5 Ink St");
    expect(c.company).toBe("Press Co");
  });
});

describe("classifyImport — the zero-conflict guarantee", () => {
  const existing = [
    { id: "qb1", name: "John Doe", company: "Acme", email: "john@acme.com", qb_customer_id: "42" },
    { id: "c2", name: "Sara Lee", company: "", email: "sara@x.com" },
    // A QB customer stored name-only (no company) — the GAP-A scenario.
    { id: "qb3", name: "Marcus Kane", company: "", email: null, qb_customer_id: "77" },
  ];
  it("skips rows matching a QB-imported customer (never inserts)", () => {
    const parsed = [{ Name: "John Doe", Company: "Acme", Email: "different@acme.com" }];
    const { toCreate, duplicates } = classifyImport(parsed, existing);
    expect(toCreate).toHaveLength(0);
    expect(duplicates[0].matchId).toBe("qb1");
  });
  it("does NOT duplicate a name-only QB customer when the CSV adds a company (GAP-A)", () => {
    const parsed = [{ Name: "Marcus Kane", Company: "Kane Design" }];
    const { toCreate, duplicates } = classifyImport(parsed, existing);
    expect(toCreate).toHaveLength(0);
    expect(duplicates[0].matchId).toBe("qb3");
  });
  it("skips email match to an existing customer", () => {
    const { toCreate, duplicates } = classifyImport([{ Name: "S. Lee", Email: "SARA@X.com" }], existing);
    expect(toCreate).toHaveLength(0);
    expect(duplicates[0].matchId).toBe("c2");
  });
  it("creates genuinely new customers only", () => {
    const { toCreate } = classifyImport([{ Name: "New Guy", Company: "Fresh Co", Email: "new@fresh.com" }], existing);
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].name).toBe("New Guy");
  });
  it("collapses within-file duplicates", () => {
    const rows = [{ Name: "Dup", Email: "d@d.com" }, { Name: "Dup", Email: "d@d.com" }];
    const { toCreate, duplicates } = classifyImport(rows, []);
    expect(toCreate).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });
  it("counts rows with nothing to key on as invalid", () => {
    const { invalid, toCreate } = classifyImport([{ Email: "", Phone: "555" }], []);
    expect(invalid).toBe(1);
    expect(toCreate).toHaveLength(0);
  });
});
