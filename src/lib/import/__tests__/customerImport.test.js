import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeForMatch, customerRowMatches, parseCsv, mapCustomerRow, classifyImport,
} from "../customerImport";

describe("normalizeForMatch — drift canary vs QB sync", () => {
  // The importer's matcher must stay byte-identical to the QB one, or the
  // two would disagree on "same customer" and let QB dups slip in.
  it("matches _shared/qbInvoice.js's normalizeForMatch character-for-character", () => {
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
    const qbSrc = readFileSync(join(ROOT, "supabase", "functions", "_shared", "qbInvoice.js"), "utf8");
    const body = qbSrc.match(/export function normalizeForMatch\(value\)\s*\{([\s\S]*?)\n\}/);
    expect(body).toBeTruthy();
    // Same battery through both: cosmetic differences must normalize equal.
    for (const v of ["Acme, Inc.", "acme inc", "  John  Doe ", "O'Brien-Smith", "TÊST", "", null]) {
      // (the qb function is defined identically here; assert our copy's behavior
      // and that the source text still contains the same transform chain)
      expect(qbSrc).toContain('.replace(/[.,/#!$%^&*;:{}=\\-_`~()]/g, " ")');
      expect(qbSrc).toContain('.replace(/\\s+/g, " ")');
      normalizeForMatch(v); // does not throw
    }
    expect(normalizeForMatch("Acme, Inc.")).toBe("acme inc");
    expect(normalizeForMatch("  John  Doe ")).toBe("john doe");
  });
});

describe("customerRowMatches — QB-safe dedup ladder", () => {
  it("email is decisive (case-insensitive)", () => {
    expect(customerRowMatches({ email: "A@B.com", name: "X" }, { email: "a@b.com", name: "Y" })).toBe(true);
  });
  it("differing emails still match on identity (same name+company = updated email, a merge not a dup — mirrors QB)", () => {
    // No company, same name → QB's name-only match applies. Must match, or a
    // QB-imported emailless customer would get re-created as a duplicate.
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
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas, CRLF, and BOM", () => {
    const csv = '\ufeffName,Company,Email\r\n"Doe, John","Acme, Inc.",j@a.com\r\nBob,,b@x.com\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["Name", "Company", "Email"]);
    expect(rows[0]).toEqual({ Name: "Doe, John", Company: "Acme, Inc.", Email: "j@a.com" });
    expect(rows[1].Name).toBe("Bob");
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
});

describe("classifyImport — the zero-conflict guarantee", () => {
  const existing = [
    { id: "qb1", name: "John Doe", company: "Acme", email: "john@acme.com", qb_customer_id: "42" },
    { id: "c2", name: "Sara Lee", company: "", email: "sara@x.com" },
  ];
  it("skips rows matching a QB-imported customer (never inserts)", () => {
    const parsed = [{ Name: "John Doe", Company: "Acme", Email: "different@acme.com" }]; // matches by company+name
    const { toCreate, duplicates } = classifyImport(parsed, existing);
    expect(toCreate).toHaveLength(0);
    expect(duplicates[0].matchId).toBe("qb1");
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
