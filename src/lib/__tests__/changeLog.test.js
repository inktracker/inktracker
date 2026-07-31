import { describe, it, expect } from "vitest";
import { diffTrackedFields, diffLineItems } from "../changeLog";

describe("diffTrackedFields", () => {
  it("names money moves with formatted before/after", () => {
    const changes = diffTrackedFields({ total: 5000 }, { total: 4995 });
    expect(changes).toEqual(["Total: $5000.00 → $4995.00"]);
  });

  it("ignores sub-cent float noise on money fields", () => {
    expect(diffTrackedFields({ total: 500 }, { total: 500.004 })).toEqual([]);
  });

  it("ignores untracked bookkeeping columns", () => {
    const changes = diffTrackedFields(
      { total: 500, qb_synced_at: "a", qb_line_snapshot: [] },
      { total: 500, qb_synced_at: "b", qb_line_snapshot: [{ i: "1" }] },
    );
    expect(changes).toEqual([]);
  });

  it("only reports fields present on the after-row (partial patches)", () => {
    // A patch that only touches invoice_id must not report the absent
    // total as having changed to $0.00.
    const changes = diffTrackedFields({ total: 500, invoice_id: "A" }, { invoice_id: "B" });
    expect(changes).toEqual(["Invoice #: A → B"]);
  });

  it("renders paid + status transitions readably", () => {
    expect(diffTrackedFields({ paid: false }, { paid: true })).toEqual(["Paid: no → yes"]);
    expect(diffTrackedFields({ status: "Pending" }, { status: "Completed" }))
      .toEqual(["Status: Pending → Completed"]);
  });

  it("returns [] when a side is missing", () => {
    expect(diffTrackedFields(null, { total: 1 })).toEqual([]);
    expect(diffTrackedFields({ total: 1 }, null)).toEqual([]);
  });
});

describe("diffLineItems", () => {
  const a = { id: "1", style: "Comfort Colors 9360 Black" };

  it("counts edited lines without dumping the itemization", () => {
    expect(diffLineItems([a], [{ ...a, style: "Comfort Colors 9360 Gray" }]))
      .toEqual(["1 line item edited"]);
  });

  it("reports additions and removals", () => {
    expect(diffLineItems([a], [a, { id: "2" }])).toEqual(["1 line item added"]);
    expect(diffLineItems([a, { id: "2" }], [a])).toEqual(["1 line item removed"]);
  });

  it("is quiet when nothing moved", () => {
    expect(diffLineItems([a], [{ ...a }])).toEqual([]);
    expect(diffLineItems(undefined, undefined)).toEqual([]);
  });
});
