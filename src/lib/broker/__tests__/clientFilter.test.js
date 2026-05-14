import { describe, it, expect } from "vitest";
import {
  filterClients,
  sortClientsByName,
  filterAndSortClients,
} from "../clientFilter.js";

const acme = { id: "1", name: "Acme Co", company: "Acme Corp", email: "buy@acme.com", tax_exempt: false };
const beta = { id: "2", name: "beta llc", company: "Beta LLC", email: "info@beta.io", tax_exempt: true };
const gamma = { id: "3", name: "Gamma Group", company: "Acme Subsidiary", email: "g@gamma.com", tax_exempt: false };

describe("filterClients", () => {
  const all = [acme, beta, gamma];

  it("returns all clients when no search / no filters", () => {
    expect(filterClients(all).map((c) => c.id)).toEqual(["1", "2", "3"]);
  });

  it("search matches name case-insensitively", () => {
    expect(filterClients(all, { search: "ACME" }).map((c) => c.id)).toEqual(["1", "3"]);
  });

  it("search matches company", () => {
    expect(filterClients(all, { search: "subsidiary" }).map((c) => c.id)).toEqual(["3"]);
  });

  it("search matches email", () => {
    expect(filterClients(all, { search: "@beta.io" }).map((c) => c.id)).toEqual(["2"]);
  });

  it("taxExempt filter narrows to exempt clients only", () => {
    expect(filterClients(all, { filters: { taxExempt: true } }).map((c) => c.id)).toEqual(["2"]);
  });

  it("search + filter combine (AND, not OR)", () => {
    // Search 'acme' would hit 1 + 3, but neither is tax-exempt → empty.
    expect(filterClients(all, { search: "acme", filters: { taxExempt: true } })).toEqual([]);
  });

  it("handles clients with missing fields without crashing", () => {
    const sparse = [{ id: "x" }, { id: "y", name: "Yvonne" }];
    expect(filterClients(sparse, { search: "yv" }).map((c) => c.id)).toEqual(["y"]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(filterClients(null)).toEqual([]);
    expect(filterClients(undefined)).toEqual([]);
  });
});

describe("sortClientsByName", () => {
  it("sorts alphabetically by name, case-insensitive", () => {
    expect(sortClientsByName([acme, beta, gamma]).map((c) => c.id))
      .toEqual(["1", "2", "3"]); // Acme, beta, Gamma — case-insensitive
  });

  it("missing names sort to the front (empty string < letters)", () => {
    const out = sortClientsByName([{ id: "x", name: "" }, acme, { id: "y" }]);
    expect(out.slice(0, 2).map((c) => c.id).sort()).toEqual(["x", "y"]);
  });

  it("does not mutate the input array", () => {
    const input = [gamma, acme];
    const out = sortClientsByName(input);
    expect(input.map((c) => c.id)).toEqual(["3", "1"]);
    expect(out.map((c) => c.id)).toEqual(["1", "3"]);
  });
});

describe("filterAndSortClients", () => {
  it("applies the filter, then sorts", () => {
    const out = filterAndSortClients(
      [gamma, beta, acme],
      { search: "acme" },
    );
    expect(out.map((c) => c.id)).toEqual(["1", "3"]);
  });
});
