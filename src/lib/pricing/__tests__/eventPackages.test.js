import { describe, it, expect } from "vitest";
import {
  normalizeEventPackages,
  hasEventPackages,
  buildEventCharges,
} from "../eventPackages";

// Reagan's real sheet (the feature's origin story).
const REAGAN = {
  enabled: true,
  hourlyRate: 125,
  packages: [
    {
      id: "t1",
      label: "Tier 1: supply your own",
      basePrice: 1000,
      minHours: 4,
      fees: [{ id: "art", label: "Art fee", amount: 150, waivable: true }],
      addOns: [],
    },
    {
      id: "t2",
      label: "Tier 2: 50 tees included",
      basePrice: 1200,
      minHours: 4,
      fees: [
        { id: "screen", label: "Screen fee", amount: 200 },
        { id: "art", label: "Art fee", amount: 150, waivable: true },
      ],
      addOns: [
        { id: "gildan", label: "Extra Gildans", rate: 5, unit: "shirt" },
        { id: "asc", label: "Extra AS Colour", rate: 9, unit: "shirt" },
      ],
    },
  ],
};

describe("normalizeEventPackages", () => {
  it("returns a disabled empty section for junk input", () => {
    expect(normalizeEventPackages(null)).toEqual({ enabled: false, hourlyRate: 0, packages: [] });
    expect(normalizeEventPackages("x").packages).toEqual([]);
  });

  it("cleans numbers, drops empty rows, defaults add-on unit to shirt", () => {
    const out = normalizeEventPackages({
      enabled: true,
      hourlyRate: "125",
      packages: [
        { label: "Tier", basePrice: "1200", minHours: "4",
          fees: [{ label: "", amount: 0 }, { label: "Screen fee", amount: "200" }],
          addOns: [{ label: "Gildan", rate: "5", unit: "" }] },
        { label: "", basePrice: 0 }, // fully empty → dropped
      ],
    });
    expect(out.hourlyRate).toBe(125);
    expect(out.packages).toHaveLength(1);
    expect(out.packages[0].fees).toEqual([{ id: expect.any(String), label: "Screen fee", amount: 200, waivable: false }]);
    expect(out.packages[0].addOns[0].unit).toBe("shirt");
  });
});

describe("hasEventPackages", () => {
  it("requires enabled AND at least one package", () => {
    expect(hasEventPackages({ eventPackages: REAGAN })).toBe(true);
    expect(hasEventPackages({ eventPackages: { ...REAGAN, enabled: false } })).toBe(false);
    expect(hasEventPackages({ eventPackages: { enabled: true, packages: [] } })).toBe(false);
    expect(hasEventPackages({})).toBe(false);
  });
});

describe("buildEventCharges", () => {
  const ev = normalizeEventPackages(REAGAN);
  const tier2 = ev.packages[1];

  it("Reagan's Tier 2, 6 hours, 20 extra Gildans, art supplied", () => {
    const rows = buildEventCharges(tier2, {
      hours: 6,
      hourlyRate: ev.hourlyRate,
      addOnQtys: { gildan: 20 },
      waivedFeeIds: ["art"],
    });
    expect(rows.map((r) => [r.label, r.amount])).toEqual([
      ["Tier 2: 50 tees included — event package (4 hr min)", 1200],
      ["Additional event hours (2 × $125/hr)", 250],
      ["Extra Gildans (20 × $5/shirt)", 100],
      ["Screen fee", 200],
    ]);
    // TAX-04 convention: charges default taxable, editable after insert.
    expect(rows.every((r) => r.taxable === true)).toBe(true);
    // ids unique within the batch
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("hours at or under the minimum add no overage row", () => {
    const rows = buildEventCharges(tier2, { hours: 4, hourlyRate: 125 });
    expect(rows.some((r) => r.label.includes("Additional event hours"))).toBe(false);
    const under = buildEventCharges(tier2, { hours: 2, hourlyRate: 125 });
    expect(under.some((r) => r.label.includes("Additional event hours"))).toBe(false);
  });

  it("hours default to the package minimum when omitted", () => {
    const rows = buildEventCharges(tier2, { hourlyRate: 125 });
    expect(rows).toHaveLength(3); // base + screen fee + art fee (not waived)
  });

  it("zero-qty add-ons and waived fees are omitted; unwaived fees included", () => {
    const rows = buildEventCharges(tier2, { hours: 4, hourlyRate: 125, addOnQtys: { gildan: 0, asc: 0 } });
    expect(rows.map((r) => r.label)).toEqual([
      "Tier 2: 50 tees included — event package (4 hr min)",
      "Screen fee",
      "Art fee",
    ]);
  });

  it("uses the caller's id generator when provided", () => {
    let n = 0;
    const rows = buildEventCharges(tier2, { hourlyRate: 125, makeId: () => `x${n++}` });
    expect(rows[0].id).toBe("x0");
  });

  it("null package → no rows", () => {
    expect(buildEventCharges(null, {})).toEqual([]);
  });
});
